const vscode = require('vscode');
const path = require('path');

const {
    toVarName,
    areStrictEqual,
    isBlank,
    removeEnd,
    createFileName,
    getDoc,
} = require('./helpers');

class DartFile {
    /**
     * @param {DartClass} clazz
     * @param {string} content
     */
    constructor(clazz, content = null) {
        this.clazz = clazz;
        this.name = createFileName(clazz.name);
        this.content = content || clazz.classContent;
    }
}

class DartClass {
    constructor() {
        /** @type {string} */
        this.name = null;
        /** @type {string} */
        this.fullGenericType = '';
        /** @type {string} */
        this.superclass = null;
        /** @type {string[]} */
        this.interfaces = [];
        /** @type {string[]} */
        this.mixins = [];
        /** @type {string} */
        this.constr = null;
        /** @type {ClassField[]} */
        this.properties = [];
        /** @type {number} */
        this.startsAtLine = null;
        /** @type {number} */
        this.endsAtLine = null;
        /** @type {number} */
        this.constrStartsAtLine = null;
        /** @type {number} */
        this.constrEndsAtLine = null;
        this.constrDifferent = false;
        this.isArray = false;
        this.classContent = '';
        this.toInsert = '';
        /** @type {ClassPart[]} */
        this.toReplace = [];
        this.isLastInFile = false;
    }

    get type() {
        return this.name + this.genericType;
    }

    get genericType() {
        const parts = this.fullGenericType.split(',');
        return parts.map((type) => {
            let part = type.trim();
            if (part.includes('extends')) {
                part = part.substring(0, part.indexOf('extends')).trim();
                if (type === parts[parts.length - 1]) {
                    part += '>';
                }
            }

            return part;
        }).join(', ');
    }

    get propsEndAtLine() {
        if (this.properties.length > 0) {
            return this.properties[this.properties.length - 1].line;
        } else {
            return -1;
        }
    }

    get hasSuperclass() {
        return this.superclass != null;
    }

    get classDetected() {
        return this.startsAtLine != null;
    }

    get didChange() {
        return this.toInsert.length > 0 || this.toReplace.length > 0 || this.constrDifferent;
    }

    get hasNamedConstructor() {
        if (this.constr != null) {
            return this.constr.replace('const', '').trimLeft().startsWith(this.name + '({');
        }

        return true;
    }

    get hasConstructor() {
        return this.constrStartsAtLine != null && this.constrEndsAtLine != null && this.constr != null;
    }

    get hasMixins() {
        return this.mixins != null && this.mixins.length > 0;
    }

    get hasInterfaces() {
        return this.interfaces != null && this.interfaces.length > 0;
    }

    get hasEnding() {
        return this.endsAtLine != null;
    }

    get hasProperties() {
        return this.properties.length > 0;
    }

    get fewProps() {
        return this.properties.length <= 3;
    }

    get isValid() {
        return this.classDetected && this.hasEnding && this.hasProperties && this.uniquePropNames;
    }

    get isWidget() {
        return this.superclass != null && (this.superclass == 'StatelessWidget' || this.superclass == 'StatefulWidget');
    }

    get isStatelessWidget() {
        return this.isWidget && this.superclass != null && this.superclass == 'StatelessWidget';
    }

    get isState() {
        return !this.isWidget && this.superclass != null && this.superclass.startsWith('State<');
    }

    get isAbstract() {
        return this.classContent.trimLeft().startsWith('abstract class');
    }

    get usesEquatable() {
        return (this.hasSuperclass && this.superclass == 'Equatable') || (this.hasMixins && this.mixins.includes('EquatableMixin'));
    }

    get issue() {
        const def = this.name + ' couldn\'t be converted to a data class: '
        let msg = def;
        if (!this.hasProperties) {
            msg += 'Class must have at least one property!';
        } else if (!this.hasEnding) {
            msg += 'Class has no ending!';
        } else if (!this.uniquePropNames) {
            msg += 'Class doesn\'t have unique property names!';
        } else {
            msg = removeEnd(msg, ': ') + '.';
        }

        return msg;
    }

    get uniquePropNames() {
        let props = [];
        for (let p of this.properties) {
            const n = p.name;
            if (props.includes(n))
                return false;
            props.push(n);
        }
        return true;
    }

    /**
     * @param {number} line
     */
    replacementAtLine(line) {
        for (let part of this.toReplace) {
            if (part.startsAt <= line && part.endsAt >= line) {
                return part.replacement;
            }
        }

        return null;
    }

    generateClassReplacement() {
        let replacement = '';
        let lines = this.classContent.split('\n');

        for (let i = this.endsAtLine - this.startsAtLine; i >= 0; i--) {
            let line = lines[i] + '\n';
            let l = this.startsAtLine + i;

            if (i == 0) {
                const classType = this.isAbstract ? 'abstract class' : 'class';
                let classDeclaration = classType + ' ' + this.name + this.fullGenericType;
                if (this.superclass != null) {
                    classDeclaration += ' extends ' + this.superclass;
                }

                /**
                 * @param {string[]} list
                 * @param {string} keyword
                 */
                function addSuperTypes(list, keyword) {
                    if (list.length == 0) return;

                    const length = list.length;
                    classDeclaration += ` ${keyword} `;
                    for (let x = 0; x < length; x++) {
                        const isLast = x == length - 1;
                        const type = list[x];
                        classDeclaration += type;

                        if (!isLast) {
                            classDeclaration += ', ';
                        }
                    }
                }

                addSuperTypes(this.mixins, 'with');
                addSuperTypes(this.interfaces, 'implements');

                classDeclaration += ' {\n';
                replacement = classDeclaration + replacement;
            } else if (l == this.propsEndAtLine && this.constr != null && !this.hasConstructor) {
                replacement = this.constr + replacement;
                replacement = line + replacement;
            } else if (l == this.endsAtLine && this.isValid) {
                replacement = line + replacement;
                replacement = this.toInsert + replacement;
            } else {
                let rp = this.replacementAtLine(l);
                if (rp != null) {
                    if (!replacement.includes(rp))
                        replacement = rp + '\n' + replacement;
                } else {
                    replacement = line + replacement;
                }
            }
        }

        return removeEnd(replacement, '\n');
    }
}

class Imports {
    /**
     * @param {string} text
     * @param {string} projectName
     */
    constructor(text, projectName) {
        /** @type {string[]} */
        this.values = [];
        /** @type {number} */
        this.startAtLine = null;
        /** @type {number} */
        this.endAtLine = null;
        /** @type {string} */
        this.rawImports = null;

        /** @type {string} */
        this.projectName = projectName;

        this.readImports(text);
    }

    get hasImports() {
        return this.values != null && this.values.length > 0;
    }

    get hasExportDeclaration() {
        return /^export /m.test(this.formatted);
    }

    get hasImportDeclaration() {
        return /^import /m.test(this.formatted);
    }

    get hasPreviousImports() {
        return this.startAtLine != null && this.endAtLine != null;
    }

    get didChange() {
        return !areStrictEqual(this.rawImports, this.formatted);
    }

    get range() {
        return new vscode.Range(
            new vscode.Position(this.startAtLine - 1, 0),
            new vscode.Position(this.endAtLine, 1),
        );
    }

    /**
     * @param {string} text
     */
    readImports(text) {
        if (!text) return;

        this.rawImports = '';
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const isLast = i == lines.length - 1;

            if (line.startsWith('import') || line.startsWith('export') || line.startsWith('part')) {
                this.values.push(line);
                this.rawImports += `${line}\n`;
                if (this.startAtLine == null) {
                    this.startAtLine = i + 1;
                }

                if (isLast) {
                    this.endAtLine = i + 1;
                    break;
                }
            } else {
                const isLicenseComment = line.startsWith('//') && this.values.length == 0;
                const didEnd = !(isBlank(line) || line.startsWith('library') || isLicenseComment);
                
                if (isLast || didEnd) {
                    if (this.startAtLine != null) {
                        if (i > 0 && isBlank(lines[i - 1])) {
                            this.endAtLine = i - 1;
                        } else {
                            this.endAtLine = i;
                        }
                    }
                    break;
                }
            }
        }
    }

    get formatted() {
        if (!this.hasImports) return '';

        let workspace = this.projectName;
        if (workspace == null || workspace.length == 0) {
            const file = getDoc().uri;
            if (file.scheme === 'file') {
                const folder = vscode.workspace.getWorkspaceFolder(file);
                if (folder) {
                    workspace = path.basename(folder.uri.fsPath).replace('-', '_');
                }
            }
        }

        const dartImports = [];
        const packageImports = [];
        const packageLocalImports = [];
        const relativeImports = [];
        const partStatements = [];
        const exports = [];

        for (let imp of this.values) {
            if (imp.startsWith('export')) {
                exports.push(imp);
            } else if (imp.startsWith('part')) {
                partStatements.push(imp);
            } else if (imp.includes('dart:')) {
                dartImports.push(imp);
            } else if (workspace != null && imp.includes(`package:${workspace}`)) {
                packageLocalImports.push(imp);
            } else if (imp.includes('package:')) {
                packageImports.push(imp);
            } else {
                relativeImports.push(imp);
            }
        }

        let imps = '';
        function addImports(imports) {
            imports.sort();
            for (let i = 0; i < imports.length; i++) {
                const isLast = i == imports.length - 1;
                const imp = imports[i];
                imps += imp + '\n';

                if (isLast) {
                    imps += '\n';
                }
            }
        }

        addImports(dartImports);
        addImports(packageImports);
        addImports(packageLocalImports);
        addImports(relativeImports);
        addImports(exports);
        addImports(partStatements);

        return removeEnd(imps, '\n');
    }

    /**
     * @param {string} imp
     */
    includes(imp) {
        return this.values.includes(imp);
    }

    /**
     * @param {string} imp
     */
    push(imp) {
        return this.values.push(imp);
    }

    /**
     * @param {string[]} imps
     */
    hasAtLeastOneImport(imps) {
        for (let imp of imps) {
            const impt = `import '${imp}';`;
            if (this.includes(impt))
                return true;
        }
        return false;
    }

    /**
     * @param {string} imp
     * @param {string[]} validOverrides
     */
    requiresImport(imp, validOverrides = []) {
        const formattedImport = !imp.startsWith('import') ? "import '" + imp + "';" : imp;

        if (!this.includes(formattedImport) && !this.hasAtLeastOneImport(validOverrides)) {
            this.values.push(formattedImport);
        }
    }
} 

class ClassField {
    /**
     * @param {String} type
     * @param {String} name
     * @param {number} line
     * @param {boolean} isFinal
     * @param {boolean} isConst
     */
    constructor(type, name, line = 1, isFinal = true, isConst = false) {
        this.rawType = type;
        this.jsonName = name;
        this.name = toVarName(name);
        this.line = line;
        this.isFinal = isFinal;
        this.isConst = isConst;
        this.isEnum = false;
        this.isCollectionType = (type) => this.rawType == type || this.rawType.startsWith(type + '<');
    }

    get type() {
        return this.isNullable ? removeEnd(this.rawType, '?') : this.rawType;
    }

    get isNullable() {
        return this.rawType.endsWith('?');
    }

    get isList() {
        return this.isCollectionType('List');
    }

    get isMap() {
        return this.isCollectionType('Map');
    }

    get isSet() {
        return this.isCollectionType('Set');
    }

    get isCollection() {
        return this.isList || this.isMap || this.isSet;
    }

    get listType() {
        if (this.isList || this.isSet) {
            const collection = this.isSet ? 'Set' : 'List';
            const type = this.rawType == collection ? 'dynamic' : this.rawType.replace(collection + '<', '').replace('>', '');
            return new ClassField(type, this.name, this.line, this.isFinal);
        }

        return this;
    }

    get isPrimitive() {
        let t = this.listType.type;
        return t == 'String' || t == 'num' || t == 'dynamic' || t == 'bool' || this.isDouble || this.isInt || this.isMap;
    }

    get defValue() {
        if (this.isList) {
            return 'const []';
        } else if (this.isMap || this.isSet) {
            return 'const {}';
        } else {
            switch (this.type) {
                case 'String': return "''";
                case 'num':
                case 'int': return "0";
                case 'double': return "0.0";
                case 'bool': return 'false';
                case 'dynamic': return "null";
                default: return `${this.type}()`;
            }
        }
    }

    get isInt() {
        return this.listType.type == 'int';
    }

    get isDouble() {
        return this.listType.type == 'double';
    }
}

class ClassPart {

    /**
     * @param {string} name
     * @param {number} startsAt
     * @param {number} endsAt
     * @param {string} current
     * @param {string} replacement
     */
    constructor(name, startsAt = null, endsAt = null, current = null, replacement = null) {
        this.name = name;
        this.startsAt = startsAt;
        this.endsAt = endsAt;
        this.current = current;
        this.replacement = replacement;
    }

    get isValid() {
        return this.startsAt != null && this.endsAt != null && this.current != null;
    }

    get startPos() {
        return new vscode.Position(this.startsAt, 0);
    }

    get endPos() {
        return new vscode.Position(this.endsAt, 0);
    }
}

module.exports = {
    DartFile,
    DartClass,
    Imports,
    ClassField,
    ClassPart,
}
