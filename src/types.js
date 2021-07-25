const nls = require('vscode-nls');
let localize = nls.loadMessageBundle();

const vscode = require('vscode');
const path = require('path');

const changeCase = require('change-case');

const {
  toVarName,
  areStrictEqual,
  isBlank,
  removeEnd,
  createFileName,
  getDoc,
} = require('./helpers');

/**
 * This class describes the class and filename binding
 *
 */
class DartFile {
  /**
   * @param {DartClass} clazz
   */
  constructor(clazz) {
    this.clazz = clazz;
    this.name = createFileName(clazz.name);
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
    /** @type {DartClassProperty[]} */
    this.properties = [];
    /** @type {number} */
    this.startsAt = null;
    /** @type {number} */
    this.endsAt = null;
    // this.constrDifferent = false;
    this.isArray = false;
    // this.initialSourceCode = '';
    /** @type {ClassPart[]} */
    this.initialParts = [];
    /** @type {ClassPart[]} */
    this.toInsert = [];
    /** @type {ClassPart[]} */
    this.toReplace = [];
    this.isLastInFile = false;
    this.abstract = false;
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
      return this.properties[this.properties.length - 1].lineNumber;
    } else {
      return -1;
    }
  }

  get hasSuperclass() {
    return this.superclass != null;
  }

  get classDetected() {
    return this.startsAt != null;
  }

  get didChange() {
    return this.toInsert.length > 0 || this.toReplace.length > 0;// || this.constrDifferent;
  }

  get hasNamedConstructor() {
    if (this.findPart('constructor') != null) {
      return this.findPart('constructor').current.replace('const', '').trimLeft().startsWith(this.name + '({');
    }

    return true;
  }

  get hasConstructor() {
    return this.findPart('constructor') != null;
    // return this.constrStartsAtLine != null && this.constrEndsAtLine != null && this.constr != null;
  }

  get hasMixins() {
    return this.mixins != null && this.mixins.length > 0;
  }

  get hasInterfaces() {
    return this.interfaces != null && this.interfaces.length > 0;
  }

  get hasEnding() {
    return this.endsAt != null;
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
    return this.abstract;
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
   * @param {string} name
   * @param {string} groupName
   */
  findPart(name, groupName = null) {
    for (const part of this.initialParts) {
      if (part.name == name && (groupName == null || part.groupName == groupName))
        return part
    }
    return null;
  }

  /**
   * @param {number} line
   */
  partAtLine(line) {
    for (let part of this.toReplace) {
      if (part.startsAt <= line && part.endsAt >= line) {
        return part;
      }
    }

    return null;
  }

  /**
   * Returns reduced version of class with only group related edits
   * @param {string} groupName
   */
  filterForPartGroup(groupName) {
    let newClass = Object.create(this);

    newClass.toReplace = []
    for (let part of this.toReplace) {
      if (part.groupName == groupName) {
        newClass.toReplace.push(part);
      }
    }
    newClass.toInsert = []
    for (let part of this.toInsert) {
      if (part.groupName == groupName) {
        newClass.toInsert.push(part);
      }
    }
    return newClass;
  }

  getClassDeclaration() {
    const classType = this.isAbstract ? 'abstract class' : 'class';
    let classDeclaration = classType + ' ' + this.name + this.fullGenericType;
    if (this.superclass != null) {
      classDeclaration += ' extends ' + this.superclass;
    }

    if (this.mixins.length > 0) {
      classDeclaration += ` with ${this.mixins.join(', ')}`
    }
    if (this.interfaces.length > 0) {
      classDeclaration += ` implements ${this.interfaces.join(', ')}`
    }

    classDeclaration += ' {';
    return classDeclaration;
  }


  // Wraps the variable in ${}
  getReplaceRegexp(variableName) {
    // ${   variableName   --some separator for formatting--    formatter }
    return new RegExp(String.raw`(?:\${)\s*${variableName}\s*(?:\:\s*(.*))?(?:})`, 'g');
  }

  replaceTemplatedContent(templatedText, replaceValues = [[]]) {
    let codeAsString = templatedText.join('\n');
    return replaceValues.reduce((acc, replaceValue) => {
      const [search, replace] = replaceValue;
      // console.log(`search with '${search}' to replace as '${replace}'`)

      var _ = acc.replace(
        this.getReplaceRegexp(search),
        (_, capturedTransformation) => {
          // console.log(`the regex captured ${capturedTransformation}`)
          if (capturedTransformation === '/camelcase') return changeCase.camelCase(replace);
          return replace
        }
      );
      // console.log(_)
      return _;
    }, codeAsString);
  }

  // Used for JSON -> class
  // (or other data class representation not relying on previous Dart code) which should currently use getFullReplaceEdit
  // FIXME: this code is returning the imports associated to a class only for the templated case (for the non-templated is done via generator)
  /**
   *
   * @param {Object} template
   * @param {string} filename Is used if there is a template
   * @returns [String, Imports]
   */
  generateClassContent(template = null, filename = null) {
    // console.log(`CamelCase ${changeCase.camelCase(localize('testKey1', 'vive la vie'))}`)
    if (template == null) {
      // class declaration
      let classContent = this.getClassDeclaration() + '\n';

      // properties
      for (let property of this.properties) {
        classContent += `  final ${property.type} ${toVarName(property.name)};\n`;
      }

      // methods (all to be inserted), only if class is valid (has properties)
      // Part generation already takes into account validity, but it might be that properties were manipulated
      if (this.isValid) {
        for (const part of this.toInsert) {
          classContent += part.replacement;
        }
      }
      classContent += '}';

      return [removeEnd(classContent, '\n'), new Imports('', '')];
    } else {
      // add external imports required for template
      let importList = new Imports('', '');

      let replaceValues = []

      // replacement value: className
      let className = `${this.name}${this.fullGenericType}`;
      replaceValues.push(['className', className]);
      // replacement value: fileName (destination)
      replaceValues.push(['fileName', path.basename(filename).split('.').slice(0, -1).join()]);

      // replacement value: fieldsContent
      let fieldsContent = ''
      for (let classField of this.properties) {
        let fieldType = classField.type
        if (template.template.typeMapping[classField.type]) {
          fieldType = template.template.typeMapping[classField.type].type;
          if (template.template.typeMapping[classField.type].imports) {
            // add external imports required import for type
            template.template.typeMapping[classField.type].imports.forEach(packageToImport => importList.requiresImport(packageToImport));
          };
        }
        fieldsContent += `  ${fieldType} get ${toVarName(classField.name)};\n`;
      }
      replaceValues.push(['fieldsContent', removeEnd(fieldsContent, '\n')]);

      // process imports/parts/etc.
      template.template.imports.forEach(packageToImport => importList.requiresImport(this.replaceTemplatedContent([packageToImport], replaceValues)));
      // Apply replacement values to template
      // let classContent = '\n//A test with template driven code \n' + this.replaceTemplatedContent(template.template.code, replaceValues);
      let classContent = '\n'+this.replaceTemplatedContent(template.template.code, replaceValues);
      return [classContent, importList];
    }
  }
}

/**
 * Holds raw preamble declarations, parses and formats
 * It doesn't support intesrpersed comments (ignores preamble after them)
 */
class Imports {
  /**
   * @param {string} text
   * @param {string} projectName
   */
  constructor(text, projectName) {
    /** @type {string[]} */
    this.values = [];
    /** @type {number} */
    this.startsAt = null;
    /** @type {number} */
    this.endsAt = null;
    /** @type {string} */
    this.rawStatements = '';

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
    return this.startsAt != null && this.endsAt != null;
  }

  get shouldChange() {
    return !areStrictEqual(this.rawStatements, this.formatted);
  }

  get range() {
    return new vscode.Range(
      new vscode.Position(this.startsAt - 1, 0),
      new vscode.Position(this.endsAt, 1),
    );
  }

  /**
   * @param {string} text
   */
  readImports(text) {
    if (!text) return;

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const isLast = i == lines.length - 1;

      if (line.startsWith('import ') || line.startsWith('export ') || line.startsWith('part ')) {
        this.values.push(line);
        this.rawStatements += `${line}\n`;
        if (this.startsAt == null) {
          this.startsAt = i + 1;
        }

        if (isLast) {
          this.endsAt = i + 1;
          break;
        }
      } else {
        const isInitialComment = line.startsWith('//') && this.values.length == 0;
        const importsSectionEnded = !(isInitialComment || line.startsWith('library ') || isBlank(line));

        if (isLast || importsSectionEnded) {
          if (this.startsAt != null) {
            if (i > 0 && isBlank(lines[i - 1])) {
              this.endsAt = i - 1;
            } else {
              this.endsAt = i;
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

    for (let statement of this.values) {
      if (statement.startsWith('export ')) {
        exports.push(statement);
      } else if (statement.startsWith('part ')) {
        partStatements.push(statement);
      } else if (statement.includes('dart:')) {
        dartImports.push(statement);
      } else if (workspace != null && statement.includes(`package:${workspace}`)) {
        packageLocalImports.push(statement);
      } else if (statement.includes('package:')) {
        packageImports.push(statement);
      } else {
        relativeImports.push(statement);
      }
    }

    let formattedStatements = '';
    function addImports(statements) {
      statements.sort();
      for (let i = 0; i < statements.length; i++) {
        const isLast = i == statements.length - 1;
        const statement = statements[i];
        formattedStatements += statement + '\n';

        if (isLast) {
          formattedStatements += '\n';
        }
      }
    }

    addImports(dartImports);
    addImports(packageImports);
    addImports(packageLocalImports);
    addImports(relativeImports);
    addImports(exports);
    addImports(partStatements);

    return removeEnd(formattedStatements, '\n');
  }

  /**
   * @param {string} importStatement
   */
  includes(importStatement) {
    return this.values.includes(importStatement);
  }

  /**
   * @param {string} importStatement
   */
  push(importStatement) {
    return this.values.push(importStatement);
  }

  /**
   * @param {string[]} packageNames
   */
  hasAtLeastOneImport(packageNames) {
    for (let packageName of packageNames) {
      const importStatement = `import '${packageName}';`;
      if (this.includes(importStatement))
        return true;
    }
    return false;
  }

  /**
   * @param {string} importStatementOrPackageName
   * @param {string[]} validOverrides
   */
  requiresImport(importStatementOrPackageName, validOverrides = []) {
    const formattedImport = (
      !importStatementOrPackageName.startsWith('import ') &&
      !importStatementOrPackageName.startsWith('export ') &&
      !importStatementOrPackageName.startsWith('part ')
    ) ? "import '" + importStatementOrPackageName + "';" : importStatementOrPackageName;

    if (!this.includes(formattedImport) && !this.hasAtLeastOneImport(validOverrides)) {
      this.values.push(formattedImport);
    }
  }
}

class DartClassProperty {
  /**
   * @param {String} type
   * @param {String} name
   * @param {number} lineNumber
   * @param {boolean} isFinal
   * @param {boolean} isConst
   */
  constructor(type, name, lineNumber = 1, isFinal = true, isConst = false) {
    this.rawType = type;
    this.jsonName = name;
    this.name = toVarName(name);
    this.lineNumber = lineNumber;
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
      return new DartClassProperty(type, this.name, this.lineNumber, this.isFinal);
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
   * @param {string} groupName
   * @param {number} startsAt
   * @param {number} endsAt
   * @param {string} current Used to determine if the part is valid (has content) and compare on generator
   * @param {string} replacement
   */
  constructor(name, groupName = null, startsAt = null, endsAt = null, current = null, replacement = null) {
    // console.log(`creating part ${name} / ${groupName}`)
    this.name = name;
    this.groupName = groupName;
    this.startsAt = startsAt;
    this.endsAt = endsAt;
    this.current = '';
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
  DartClassProperty,
  ClassPart,
}
