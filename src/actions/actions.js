const vscode = require('vscode');
const {DartClassReader} = require('../readers/dart_class_reader');
const {DataClassGenerator} = require('../data_class_generator');

const {
    DartClass,
    Imports,
} = require('../types');

const {
    readSetting,
    readSettings,
} = require('../helpers');
const {
    getReplaceEdit,
} = require('../editor_helpers');

class DataClassCodeActions {
    /**
     * @param {boolean} isFlutter
     * @param {string} projectName
     */
    constructor(isFlutter, projectName) {
        this.clazz = new DartClass();
        this.reader = null;
        this.generator = null;
        this.document = null;
        this.isFlutter = isFlutter;
        this.projectName = projectName;
        this.documentVersion = -1
    }

    get uri() {
        return this.document.uri;
    }

    /**
     * @param {vscode.TextDocument} document
     * @param {vscode.Range} range
     */
    provideCodeActions(document, range) {
        if (!readSetting('quick_fixes')) {
            return;
        }

        if (!this.document || this.documentVersion != document.version) {
            // Reparse only if there are changes
            this.reader = new DartClassReader(document.getText(), null, this.projectName);
            this.generator = new DataClassGenerator(document.getText(), null, false, null, this.isFlutter, this.projectName);
            this.documentVersion = document.version
        }

        this.document = document;
        const lineNumber = range.start.line + 1;
        this.clazz = this.getClass(lineNumber);

        // * Class independent code actions.
        const codeActions = [
            this.createImportsFix(lineNumber, this.reader.imports),
        ];

        if (this.clazz == null || !this.clazz.isValid) {
            return codeActions;
        }

        const isAtClassDeclaration = lineNumber == this.clazz.startsAtLine;
        const isInProperties = this.clazz.properties.find((p) => p.lineNumber == lineNumber) != undefined;
        const isInConstrRange = lineNumber >= this.clazz.constrStartsAtLine && lineNumber <= this.clazz.constrEndsAtLine;
        if (!(isAtClassDeclaration || isInProperties || isInConstrRange)) return codeActions;

        // * Class code actions.
        if (!this.clazz.isWidget)
            codeActions.push(this.createDataClassFix(this.clazz));

        if (readSetting('constructor.enabled'))
            codeActions.push(this.createConstructorFix());

        // Only add constructor fix for widget classes.
        if (!this.clazz.isWidget) {
            // Copy with and JSON serialization should be handled by
            // subclasses.
            if (!this.clazz.isAbstract) {
                if (readSetting('copyWith.enabled'))
                    codeActions.push(this.createCopyWithFix());
                if (readSettings(['toMap.enabled', 'fromMap.enabled', 'toJson.enabled', 'fromJson.enabled']))
                    codeActions.push(this.createSerializationFix());
            }

            if (readSetting('toString.enabled'))
                codeActions.push(this.createToStringFix());

            if (this.clazz.usesEquatable || readSetting('useEquatable'))
                codeActions.push(this.createUseEquatableFix());
            else {
                if (readSettings(['equality.enabled', 'hashCode.enabled']))
                    codeActions.push(this.createEqualityFix());
            }
        }

        return codeActions;
    }

    /**
     * @param {string} description
     * @param {(arg0: vscode.WorkspaceEdit) => void} editor
     */
    createFix(description, editor) {
        const fix = new vscode.CodeAction(description, vscode.CodeActionKind.QuickFix);
        const edit = new vscode.WorkspaceEdit();
        editor(edit);
        fix.edit = edit;
        return fix;
    }

    /**
     * @param {DartClass} clazz
     */
    createDataClassFix(clazz) {
        if (clazz.didChange) {
            const fix = new vscode.CodeAction('Generate data class', vscode.CodeActionKind.QuickFix);
            fix.edit = this.getClazzEdit(clazz);
            return fix;
        }
    }

    /**
     * @param {string} part
     * @param {string} description
     */
    constructQuickFix(part, description) {
        const generator = new DataClassGenerator(this.document.getText(), null, false, part, this.isFlutter, this.projectName);
        const fix = new vscode.CodeAction(description, vscode.CodeActionKind.QuickFix);
        const clazz = this.findQuickFixClazz(generator);
        if (clazz != null && clazz.didChange) {
            fix.edit = this.getClazzEdit(clazz, generator.imports);
            return fix;
        }
    }

    /** @param {DataClassGenerator} generator */
    findQuickFixClazz(generator) {
        for (let clazz of generator.clazzes) {
            if (clazz.name == this.clazz.name)
                return clazz;
        }
    }

    /**
     * @param {DartClass} clazz
     */
    getClazzEdit(clazz, imports = null) {
        return getReplaceEdit(clazz, imports || this.generator.imports);
    }

    createConstructorFix() {
        return this.constructQuickFix('constructor', 'Generate constructor');
    }

    createCopyWithFix() {
        return this.constructQuickFix('copyWith', 'Generate copyWith');
    }

    createSerializationFix() {
        return this.constructQuickFix('serialization', 'Generate JSON serialization');
    }

    createToStringFix() {
        return this.constructQuickFix('toString', 'Generate toString');
    }

    createEqualityFix() {
        return this.constructQuickFix('equality', 'Generate equality');
    }

    createUseEquatableFix() {
        return this.constructQuickFix('useEquatable', `Generate Equatable`);
    }

    /**
     * @param {number} lineNumber
     * @param {Imports} imports
     */
    createImportsFix(lineNumber, imports) {
        if (!imports.shouldChange) return;

        const inImportsRange = lineNumber >= imports.startAtLine && lineNumber <= imports.endAtLine;
        if (inImportsRange) {
            let title = 'Sort imports';
            if (imports.hasImportDeclaration && imports.hasExportDeclaration) {
                title = 'Sort imports/exports';
            } else if (imports.hasExportDeclaration) {
                title = 'Sort exports';
            }

            return this.createFix(title, (edit) => {
                edit.replace(this.uri, imports.range, imports.formatted);
            });
        }
    }

    /**
     * @param {number} lineNumber
     */
    getClass(lineNumber) {
        for (let clazz of this.generator.clazzes) {
            if (clazz.startsAtLine <= lineNumber && clazz.endsAtLine >= lineNumber) {
                return clazz;
            }
        }
    }
}

module.exports = {
    DataClassCodeActions,
}
