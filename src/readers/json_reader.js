const vscode = require('vscode');

const {DataClassGenerator} = require('../data_class_generator');

const {
    DartFile,
    DartClass,
    DartClassProperty,
} = require('../types');

const {
    getEditor,
    capitalize,
    removeEnd,
    toVarName,
    createFileName,
    getCurrentPath,
    writeFile,
} = require('../helpers');

const {
    editorReplace,
    editorInsert,
} = require('../editor_helpers');

class JsonReader {
    /**
     * @param {boolean} isFlutter
     * @param {string} projectName
     * @param {string} source
     * @param {string} className
     */
    constructor(isFlutter, projectName, source, className) {
        this.json = this.toPlainJson(source);

        this.clazzName = capitalize(className);
        /** @type {DartClass[]} */
        this.clazzes = [];
        /** @type {DartFile[]} */
        this.files = [];

        this.error = this.checkJson();
        this.isFlutter = isFlutter;
        this.projectName = projectName;
    }

    async checkJson() {
        const isArray = this.json.startsWith('[');
        if (isArray && !this.json.includes('{')) {
            return 'Primitive JSON arrays are not supported! Please serialize them directly.';
        }

        if (await this.generateFiles()) {
            return 'The provided JSON is malformed or couldn\'t be parsed!';
        }

        return null;
    }

    /**
     * @param {string} source
     */
    toPlainJson(source) {
        return source.replace(new RegExp(' ', 'g'), '').replace(new RegExp('\n', 'g'), '');
    }

    /**
     * @param {any} value
     */
    getPrimitive(value) {
        let type = typeof (value);
        let sType = null;

        if (type === 'number') {
            sType = Number.isInteger(value) ? 'int' : 'double';
        } else if (type === 'string') {
            sType = 'String'
        } else if (type === 'boolean') {
            sType = 'bool';
        }

        return sType;
    }

    /**
     * Create DartClasses from a JSON mapping with class content and properties.
     * This is intended only for creating new files not overriding exisiting ones.
     * 
     * @param {any} object
     * @param {string} key
     */
    getClazzes(object, key) {
        let clazz = new DartClass();
        clazz.startsAt = 1;
        clazz.name = capitalize(key);

        let isArray = false;
        if (object instanceof Array) {
            isArray = true;
            clazz.isArray = true;
            clazz.name += 's';
        } else {
            // Top level arrays are currently not supported!
            this.clazzes.push(clazz);
            console.log(`got ${this.clazzes.length} classes from JSON`)
        }

        let i = 1;
        clazz.initialSourceCode += 'class ' + clazz.name + ' {\n';
        for (let key in object) {
            // named key for class names.
            let k = !isArray ? key : removeEnd(clazz.name.toLowerCase(), 's');

            let value = object[key];
            let type = this.getPrimitive(value);

            if (type == null) {
                if (value instanceof Array) {
                    if (value.length > 0) {
                        let listType = k;
                        // Adjust the class name of lists. E.g. a key with items
                        // becomes a class name of Item.
                        if (k.endsWith('ies')) listType = removeEnd(k, 'ies') + 'y';
                        if (k.endsWith('s')) listType = removeEnd(k, 's');
                        const i0 = this.getPrimitive(value[0]);

                        if (i0 == null) {
                            this.getClazzes(value[0], listType);
                            type = 'List<' + capitalize(listType) + '>';
                        } else {
                            type = 'List<' + i0 + '>';
                        }
                    } else {
                        type = 'List<dynamic>';
                    }
                } else {
                    this.getClazzes(value, k);
                    type = !isArray ? capitalize(key) : `List<${capitalize(k)}>`;
                }
            }

            clazz.properties.push(new DartClassProperty(type, k, ++i));
            clazz.initialSourceCode += `  final ${type} ${toVarName(k)};\n`;

            // If object is JSONArray, break after first item.
            if (isArray) break;
        }
        clazz.endsAt = ++i;
        clazz.initialSourceCode += '}';
    }

    /**
     * @param {string} property
     */
    getGeneratedTypeCount(property) {
        let p = new DartClassProperty(property, 'x');
        let i = 0;
        if (!p.isPrimitive) {
            for (let clazz of this.clazzes) {
                if (clazz.name == p.rawType) {
                    i++;
                }
            }
        }

        return i;
    }

    async generateFiles() {
        try {
            const json = JSON.parse(this.json);
            console.log('got json')
            this.getClazzes(json, this.clazzName);
            console.log('generated classes')
            this.removeDuplicates();

            for (let clazz of this.clazzes) {
                this.files.push(new DartFile(clazz));
            }
            console.log(`got ${this.files.length} files generated`)
            return false;
        } catch (e) {
            console.log(e.msg);
            return true;
        }
    }

    // If multiple classes of the same class exist, remove the duplicates
    // before writing them.
    removeDuplicates() {
        let dedupClasses = [];
        let clazzes = this.clazzes.map((aClass) => aClass.initialSourceCode);
        clazzes.forEach((aClass, index) => {
            if (clazzes.indexOf(aClass) == index) {
                dedupClasses.push(this.clazzes[index]);
            }
        });

        this.clazzes = dedupClasses;
    }

    /**
     * @param {DataClassGenerator} generator
     */
    addGeneratedFilesAsImport(generator) {
        const clazz = generator.clazzes[0];
        for (let prop of clazz.properties) {
            // Import only inambigous generated types.
            // E.g. if there are multiple generated classes with
            // the same name, do not include an import of that class.
            if (this.getGeneratedTypeCount(prop.listType.rawType) == 1) {
                const imp = `import '${createFileName(prop.listType.rawType)}.dart';`;
                generator.imports.push(imp);
            }
        }
    }

    /**
     * @param {vscode.Progress} progress
     * @param {boolean} separate
     */
    async commitJson(progress, separate) {
        console.log('committing JSON to file')
        let sourcePath = getCurrentPath();
        let fileContent = '';

        const length = this.files.length;
        for (let i = 0; i < length; i++) {
            const file = this.files[i];
            const isLast = i == length - 1;
            const generator = new DataClassGenerator([file.clazz], null /* imports */, true, this.isFlutter, this.projectName);

            if (separate)
                this.addGeneratedFilesAsImport(generator)

            const imports = `${generator.imports.formatted}\n`;

            progress.report({
                increment: ((1 / length) * 100),
                message: `Creating file ${file.name}...`
            });
            console.warn(`Creating file ${file.name}`)
            if (separate) {
                const clazz = generator.clazzes[0];

                const replacement = imports + clazz.generateClassReplacement();
                if (i > 0) {
                    await writeFile(replacement, file.name, false, sourcePath);
                } else {
                    await getEditor().edit(editor => {
                        editorReplace(editor, 0, null, replacement);
                    });
                }

                // Slow the writing process intentionally down.
                await new Promise(resolve => setTimeout(() => resolve(), 120));
            } else {
                // Insert in current file when JSON should not be separated.
                for (let clazz of generator.clazzes) {
                    fileContent += clazz.generateClassReplacement() + '\n\n';
                }

                if (isLast) {
                    fileContent = removeEnd(fileContent, '\n\n');
                    await getEditor().edit(editor => {
                        editorReplace(editor, 0, null, fileContent);
                        editorInsert(editor, 0, imports);
                    });
                }
            }
        }
    }
}

module.exports = {
    JsonReader,
}