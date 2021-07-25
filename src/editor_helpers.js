const vscode = require('vscode');

const {
  DartClass,
  Imports,
} = require('./types');

const {
  getDoc,
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
    new vscode.Position(end || getDoc().lineCount, 1)
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
      new vscode.Position(to || getDoc().lineCount - 1, 1)
    )
  );
}

/**
 * Generates the workspace edit required
 *
 * @param {any} values
 * @param {Imports} imports
 * @param {boolean} showLogs
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
        for (const rr of clazz.toReplace) {
          // console.log(`toReplace (${rr.name}): ${rr.startsAt} til ${rr.endsAt}`)
          edit.replace(uri, new vscode.Range(
            new vscode.Position(rr.startsAt - 1, 0),
            new vscode.Position(rr.endsAt - 1, getDoc().lineAt(rr.endsAt - 1).range.end.character)
          ), rr.replacement);
        }

        for (const rr of clazz.toInsert) {
          // console.log(`toInsert (${rr.name}): ${clazz.endsAt}`)
          edit.insert(uri, new vscode.Position(clazz.endsAt - 1, 0),
            rr.replacement);
        }

        // Now adapt class declaration (properties are the base, and untouched)
        edit.replace(uri, new vscode.Range(
          new vscode.Position(clazz.startsAt - 1, 0),
          new vscode.Position(clazz.startsAt - 1, getDoc().lineAt(clazz.startsAt - 1).range.end.character)
        ), clazz.getClassDeclaration());

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
    const areImportsSeparated = !hasMultiple || (imports.startsAt || 0) < clazzes[0].startsAt - 1;
    if (imports.hasPreviousImports && areImportsSeparated) {
      edit.replace(uri, imports.range, imports.formatted);
    } else {
      edit.insert(uri, new vscode.Position(imports.startsAt, 0), imports.formatted + '\n');
    }
  }

  return edit;
}

/**
 * @param {any} values
 * @param {Imports} imports
 * @param {boolean} showLogs
 */
function getFullReplaceEdit(values, imports = null, showLogs = false) {
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
            new vscode.Position((clazz.startsAt - 1), 0),
            new vscode.Position(clazz.endsAt, 1)
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
    const areImportsSeparated = !hasMultiple || (imports.startsAt || 0) < clazzes[0].startsAt - 1;
    if (imports.hasPreviousImports && areImportsSeparated) {
      edit.replace(uri, imports.range, imports.formatted);
    } else {
      edit.insert(uri, new vscode.Position(imports.startsAt, 0), imports.formatted + '\n');
    }
  }

  return edit;
}

module.exports = {
  getReplaceEdit,
  getFullReplaceEdit,
  editorDelete,
  editorInsert,
  editorReplace,
}