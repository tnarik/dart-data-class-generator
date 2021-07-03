const vscode = require('vscode');

const {
    DartClass,
    Imports,
} = require('./types');

const {
    getDoc,
    getDocText,
    showInfo,
    showError,
    isBlank,
} = require('./helpers');


/**
 * @param {vscode.TextEditorEdit} editor
 * @param {number} start
 * @param {number} end
 * @param {string} value
 */
 function editorReplace(editor, start = null, end = null, value) {
    editor.replace(new vscode.Range(
        new vscode.Position(start || 0, 0),
        new vscode.Position(end || getDocText().split('\n').length, 1)
    ),
        value
    );
}

/**
 * @param {vscode.TextEditorEdit} editor
 * @param {number} at
 * @param {string} value
 */
function editorInsert(editor, at, value) {
    editor.insert(new vscode.Position(at, 0), value);
}

/**
 * @param {vscode.TextEditorEdit} editor
 * @param {number} from
 * @param {number} to
 */
function editorDelete(editor, from = null, to = null) {
    editor.delete(
        new vscode.Range(
            new vscode.Position(from || 0, 0),
            new vscode.Position(to || getDocText().split('\n').length, 1)
        )
    );
}

/**
 * @param {any} values
 * @param {Imports} imports
 */
 function getReplaceEdit(values, imports = null, showLogs = false) {
    /** @type {DartClass[]} */
    const clazzes = values instanceof DartClass ? [values] : values;
    const hasMultiple = clazzes.length > 1;
    const edit = new vscode.WorkspaceEdit();
    const uri = getDoc().uri;

    const noChanges = [];
    for (var i = clazzes.length - 1; i >= 0; i--) {
        const clazz = clazzes[i];

        if (clazz.isValid) {
            if (clazz.didChange) {
                let replacement = clazz.generateClassReplacement();
                // Separate the classes with a new line when multiple
                // classes are being generated.
                if (!clazz.isLastInFile) {
                    replacement += '\n';
                }

                if (!isBlank(replacement)) {
                    edit.replace(uri, new vscode.Range(
                        new vscode.Position((clazz.startsAtLine - 1), 0),
                        new vscode.Position(clazz.endsAtLine, 1)
                    ), replacement);
                }
            } else if (showLogs) {
                noChanges.push(clazz.name);
                if (i == 0) {
                    const info = noChanges.length == 1 ? `class ${noChanges[0]}` : `classes ${noChanges.join(', ')}`;
                    showInfo(`No changes detected for ${info}`);
                }
            }
        } else if (showLogs) {
            showError(clazz.issue);
        }
    }

    // If imports need to be inserted, do it at the top of the file.
    if (imports != null && imports.hasImports) {
        // Imports must be separated by at least one line because otherwise we get an overlapping range error
        // from the vscode editor.
        const areImportsSeparated = !hasMultiple || (imports.startAtLine || 0) < clazzes[0].startsAtLine - 1;
        if (imports.hasPreviousImports && areImportsSeparated) {
            edit.replace(uri, imports.range, imports.formatted);
        } else {
            edit.insert(uri, new vscode.Position(imports.startAtLine, 0), imports.formatted + '\n');
        }
    }

    return edit;
}

module.exports = {
    getReplaceEdit,
    editorDelete,
    editorInsert,
    editorReplace,
}