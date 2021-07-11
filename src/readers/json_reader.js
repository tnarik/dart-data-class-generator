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
    createFileName,
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
        this.className = capitalize(className);
        /** @type {DartClass[]} */
        this.clazzes = [];
        /** @type {DartFile[]} */
        this.files = [];

        this.error = this.parseJson(source);
        this.isFlutter = isFlutter;
        this.projectName = projectName;
    }

    async parseJson(source) {
        const isArray = source.startsWith('[');
        if (isArray && !source.includes('{')) {
            return 'Primitive JSON arrays are not supported! Please serialize them directly.';
        }

        if (await this.generateClassFiles(source)) {
            return 'The provided JSON is malformed or couldn\'t be parsed!';
        }

        return null;
    }

    /**
     * @param {any} value
     */
    getPrimitiveTypeFromValue(value) {
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
    generateClass(object, key) {
        let aClazz = new DartClass();
        aClazz.startsAt = 1;
        aClazz.name = capitalize(key);

        let isArray = false;
        if (object instanceof Array) {
            isArray = true;
            aClazz.isArray = true;
            aClazz.name += 's';
        } else {
            // Top level arrays are currently not supported!
            this.clazzes.push(aClazz);
            console.log(`got ${this.clazzes.length} classes from JSON`)
        }

        let i = 1;
        for (let key in object) {
            // named key for class names.
            let k = !isArray ? key : removeEnd(aClazz.name.toLowerCase(), 's');

            let value = object[key];
            let type = this.getPrimitiveTypeFromValue(value);

            if (type == null) {
                if (value instanceof Array) {
                    if (value.length > 0) {
                        let listType = k;
                        // Adjust the class name of lists. E.g. a key with items
                        // becomes a class name of Item.
                        if (k.endsWith('ies')) listType = removeEnd(k, 'ies') + 'y';
                        if (k.endsWith('s')) listType = removeEnd(k, 's');
                        const typeFirstItem = this.getPrimitiveTypeFromValue(value[0]);

                        if (typeFirstItem == null) {
                            this.generateClass(value[0], listType);
                            type = 'List<' + capitalize(listType) + '>';
                        } else {
                            type = 'List<' + typeFirstItem + '>';
                        }
                    } else {
                        type = 'List<dynamic>';
                    }
                } else {
                    this.generateClass(value, k);
                    type = !isArray ? capitalize(key) : `List<${capitalize(k)}>`;
                }
            }

            aClazz.properties.push(new DartClassProperty(type, k, ++i));
            // If object is JSONArray, break after first item.
            if (isArray) break;
        }
        aClazz.endsAt = ++i;
    }

    /**
     * @param {string} propertyType
     */
    getGeneratedTypeCount(propertyType) {
        let p = new DartClassProperty(propertyType, 'x');
        let i = 0;
        if (!p.isPrimitive) {
            for (let aClass of this.clazzes) {
                if (aClass.name == p.rawType) {
                    i++;
                }
            }
        }
        return i;
    }

    async generateClassFiles(source) {
        try {
            const json = JSON.parse(source);
            this.generateClass(json, this.className);
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
    // , based on class name and properties (this should also be prevented during parsing)
    removeDuplicates() {
        let dedupClasses = [];
        this.clazzes.forEach(aClass => {
            let duplicated = false;
            // name and properties check
            for (const c of dedupClasses.filter(dedupClass => dedupClass.name === aClass.name )) {
                if (c.properties.length == aClass.properties.length){
                    let aClassPropertiesSorted = aClass.properties
                        .map(prop => ({name: prop.name, t: prop.rawType}))
                        .sort((a, b) => (a.name > b.name) ? 1 : -1)
                    let cPropertiesSorted = c.properties
                        .map(prop => ({name: prop.name, t: prop.rawType}))
                        .sort((a, b) => (a.name > b.name) ? 1 : -1)
                    if ( JSON.stringify(aClassPropertiesSorted) === JSON.stringify(cPropertiesSorted) )
                        duplicated = true
                        break;
                }
            }
            if (!duplicated) dedupClasses.push(aClass);
        });
        this.clazzes = dedupClasses;
    }

    /**
     * @param {DataClassGenerator} generator
     */
    addGeneratedFilesAsImport(generator) {
        const clazz = generator.clazzes[0];
        for (let prop of clazz.properties) {
            // Import only unambiguous generated types.
            // E.g. if there are multiple generated classes with
            // the same name, do not include an import for that class.
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
                increment: 100*i/(length - 1),
                message: `Creating file ${file.name}...`
            });
            console.warn(`Creating file ${file.name}`)
            if (separate) {
                const replacement = imports + generator.clazzes[0].generateClassReplacement();
                if (i == 0) {
                    await getEditor().edit(editor => editorReplace(editor, 0, null, replacement));
                } else {
                    await writeFile(replacement, file.name, false);
                }

                // Slow the writing process intentionally down.
                await new Promise(resolve => setTimeout(() => resolve(), 120));
            } else {
                // Insert in current file when JSON should not be separated.
                for (let aClass of generator.clazzes) {
                    fileContent += aClass.generateClassReplacement() + '\n\n';
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