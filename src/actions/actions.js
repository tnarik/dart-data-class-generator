const nls = require('vscode-nls');
let localize = nls.loadMessageBundle();

const vscode = require('vscode');
const { DartClassReader } = require('../readers/dart_class_reader');
const { DataClassGenerator } = require('../data_class_generator');

const {
  DartClass, // eslint-disable-line no-unused-vars
  Imports, // eslint-disable-line no-unused-vars
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
    this.reader = null;
    this.generator = null;
    this.isFlutter = isFlutter;
    this.projectName = projectName;
    this.previousDocument = null;
    this.previousDocumentVersion = -1
    this.previousRange = null;
    this.cachedCodeActions = [];
  }

  get uri() {
    return this.previousDocument.uri;
  }

  /**
   * @param {vscode.TextDocument} document
   * @param {vscode.Range} range
   */
  provideCodeActions(document, range) {
    if (!readSetting('quick_fixes')) {
      return;
    }
    if (!this.previousDocument || this.previousDocument != document || this.previousDocumentVersion != document.version) {
      // Reparse only if there are changes
      this.reader = new DartClassReader(document.getText(), null, this.projectName);
      this.generator = new DataClassGenerator(this.reader.theClasses, this.reader.imports, false, this.isFlutter, this.projectName);
      this.previousDocumentVersion = document.version
    } else {
      if (this.previousRange && this.previousRange.start.line == range.start.line && this.cachedCodeActions) {
        return this.cachedCodeActions;
      }
    }
    this.previousDocument = document;
    this.previousRange = range;

    const lineNumber = range.start.line + 1;
    let clazz = this.getClass(lineNumber);

    // Class independent code actions.
    const codeActions = [
      this.createImportsFix(lineNumber, this.reader.imports),
    ];

    if (clazz == null || !clazz.isValid) {
      return codeActions;
    }

    let isInConstrRange = false;
    if (clazz.hasConstructor) {
      let constr = clazz.findPart('constructor')
      isInConstrRange = lineNumber >= constr.startsAt && lineNumber <= constr.endsAt
    }
    const isAtClassDeclaration = lineNumber == clazz.startsAt;
    const isInProperties = clazz.properties.find((p) => p.lineNumber == lineNumber) != undefined;
    if (!(isAtClassDeclaration || isInProperties || isInConstrRange)) return codeActions;

    // Class code actions.
    if (!clazz.isWidget)
      codeActions.push(this.createDataClassFix(clazz));

    if (readSetting('constructor.enabled'))
      codeActions.push(this.createConstructorFix(clazz));

    // Only add constructor fix for widget classes.
    if (!clazz.isWidget) {
      // Copy with and JSON serialization should be handled by
      // subclasses.
      if (!clazz.isAbstract) {
        if (readSetting('copyWith.enabled'))
          codeActions.push(this.createCopyWithFix(clazz));
        if (readSettings(['toMap.enabled', 'fromMap.enabled', 'toJson.enabled', 'fromJson.enabled']))
          codeActions.push(this.createSerializationFix(clazz));
      }

      if (readSetting('toString.enabled'))
        codeActions.push(this.createToStringFix(clazz));

      if (clazz.usesEquatable || readSetting('useEquatable'))
        codeActions.push(this.createUseEquatableFix(clazz));
      else {
        if (readSettings(['equality.enabled', 'hashCode.enabled']))
          codeActions.push(this.createEqualityFix(clazz));
      }
    }

    this.cachedCodeActions = codeActions;
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
      // console.log('dataclass fix')
      const fix = new vscode.CodeAction(localize('act.dtaclass', 'Generate data class 0'), vscode.CodeActionKind.QuickFix);
      fix.edit = this.getClazzEdit(clazz, null);
      return fix;
    }
  }

  /**
   * This builds a new class replacement, specific for a given fix
   * @param {DartClass} theClass
   * @param {string} groupName
   * @param {string} description
   */
  constructQuickFix(theClass, groupName, description) {
    // console.log(`creating quick fix for ${groupName}`)
    const fix = new vscode.CodeAction(localize('act.dtaclass2', description), vscode.CodeActionKind.QuickFix);
    const clazz = this.findQuickFixClazz(theClass, groupName);
    if (clazz != null && clazz.didChange) {
      fix.edit = this.getClazzEdit(clazz, this.generator.imports);
      return fix;
    }
  }

  /**
   * Returns only the subset of fixes required for groupName
   *  @param {DartClass} theClass
   *  @param {string} groupName
   * */
  findQuickFixClazz(theClass, groupName) {
    return theClass.filterForPartGroup(groupName);
  }

  /**
   * @param {DartClass} clazz
   * @param {Imports} imports
   */
  getClazzEdit(clazz, imports = null) {
    return getReplaceEdit(clazz, imports || this.generator.imports, false);
  }

  createConstructorFix(clazz) {
    return this.constructQuickFix(clazz, 'constructor', 'Generate constructor 0');
  }

  createCopyWithFix(clazz) {
    return this.constructQuickFix(clazz, 'copyWith', 'Generate copyWith 0');
  }

  createSerializationFix(clazz) {
    return this.constructQuickFix(clazz, 'serialization', 'Generate JSON serialization 0');
  }

  createToStringFix(clazz) {
    return this.constructQuickFix(clazz, 'toString', 'Generate toString 0');
  }

  createEqualityFix(clazz) {
    return this.constructQuickFix(clazz, 'equality', 'Generate equality 0');
  }

  createUseEquatableFix(clazz) {
    return this.constructQuickFix(clazz, 'useEquatable', `Generate Equatable`);
  }

  /**
   * @param {number} lineNumber
   * @param {Imports} imports
   */
  createImportsFix(lineNumber, imports) {
    if (!imports.shouldChange) return;

    const inImportsRange = lineNumber >= imports.startsAt && lineNumber <= imports.endsAt;
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
      if (clazz.startsAt <= lineNumber && clazz.endsAt >= lineNumber) {
        return clazz;
      }
    }
  }
}

module.exports = {
  DataClassCodeActions,
}
