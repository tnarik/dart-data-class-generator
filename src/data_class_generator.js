const {
    DartClass,
    Imports,
    DartClassProperty,
    ClassPart,
} = require('./types');

const {
    removeStart,
    removeEnd,
    isBlank,
    areStrictEqual,
    readSetting,
} = require('./helpers');

/**
* @param {string} source
* @param {string[]} matches
*/
function includesOne(source, matches, wordBased = true) {
    const words = wordBased ? source.split(' ') : [source];
    for (let word of words) {
        for (let match of matches) {
            if (wordBased) {
                if (word === match)
                    return true;
            } else {
                if (source.includes(match))
                    return true;
            }
        }
    }

    return false;
}

/**
* @param {string} source
* @param {string[]} matches
*/
function includesAll(source, matches) {
    for (let match of matches) {
        if (!source.includes(match))
            return false;
    }
    return true;
}

/**
* @param {string} source
* @param {string} match
*/
function count(source, match) {
    let count = 0;
    let length = match.length;
    for (let i = 0; i < source.length; i++) {
        let part = source.substr((i * length) - 1, length);
        if (part == match) {
            count++;
        }
    }

    return count;
}


/**
 * @param {string} source
 */
 function indent(source) {
    let r = '';
    for (let line of source.split('\n')) {
        r += '  ' + line + '\n';
    }
    return r.length > 0 ? r : source;
}

// FIXME: fromJSON is used only for the insertFromMap method.
class DataClassGenerator {
    /**
     * @param {string} text
     * @param {DartClass[]} clazzes
     * @param {boolean} fromJSON
     * @param {string} part
     * @param {boolean} isFlutter
     * @param {string} projectName
     */
    constructor(text, clazzes = null, fromJSON = false, part = null, isFlutter = false, projectName = null) {
        this.fromJSON = fromJSON;
        this.clazzes = clazzes == null ? this.parseAndReadClasses(text) : clazzes;
        this.isFlutter = isFlutter;
        this.projectName = projectName;
        this.imports = new Imports(text, projectName);
        this.part = part;
        this.generateDataClazzes();
        this.clazz = null;
    }

    get hasImports() {
        return this.imports.hasImports;
    }

    /**
     * @param {string} imp
     * @param {string[]} validOverrides
     */
    requiresImport(imp, validOverrides = []) {
        this.imports.requiresImport(imp, validOverrides);
    }

    /**
     * @param {string} part
     */
    isPartSelected(part) {
        return this.part == null || this.part == part;
    }

    generateDataClazzes() {
        const insertConstructor = readSetting('constructor.enabled') && this.isPartSelected('constructor');

        for (let clazz of this.clazzes) {
            this.clazz = clazz;

            if (insertConstructor)
                this.insertConstructor(clazz);

            if (!clazz.isWidget) {
                if (!clazz.isAbstract) {
                    if (readSetting('copyWith.enabled') && this.isPartSelected('copyWith'))
                        this.insertCopyWith(clazz);
                    if (readSetting('toMap.enabled') && this.isPartSelected('serialization'))
                        this.insertToMap(clazz);
                    if (readSetting('fromMap.enabled') && this.isPartSelected('serialization'))
                        this.insertFromMap(clazz);
                    if (readSetting('toJson.enabled') && this.isPartSelected('serialization'))
                        this.insertToJson(clazz);
                    if (readSetting('fromJson.enabled') && this.isPartSelected('serialization'))
                        this.insertFromJson(clazz);
                }

                if (readSetting('toString.enabled') && this.isPartSelected('toString'))
                    this.insertToString(clazz);

                if ((clazz.usesEquatable || readSetting('useEquatable')) && this.isPartSelected('useEquatable')) {
                    this.insertEquatable(clazz);
                } else {
                    if (readSetting('equality.enabled') && this.isPartSelected('equality'))
                        this.insertEquality(clazz);
                    if (readSetting('hashCode.enabled') && this.isPartSelected('equality'))
                        this.insertHash(clazz);
                }
            }
        }
    }

    /**
     * @param {string} name
     * @param {string} finder
     * @param {DartClass} clazz
     */
    findPart(name, finder, clazz) {
        const normalize = (src) => {
            let result = '';
            let generics = 0;
            let prevChar = '';
            for (const char of src) {
                if (char == '<') generics++;
                if (char != ' ' && generics == 0) {
                    result += char;
                }

                if (prevChar != '=' && char == '>') generics--;
                prevChar = char;
            }

            return result;
        }

        const finderString = normalize(finder);
        const lines = clazz.classContent.split('\n');
        const part = new ClassPart(name);
        let curlies = 0;
        let singleLine = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = clazz.startsAtLine + i;

            curlies += count(line, '{');
            curlies -= count(line, '}');

            if (part.startsAt == null && normalize(line).startsWith(finderString)) {
                if (line.includes('=>')) singleLine = true;
                if (curlies == 2 || singleLine) {
                    part.startsAt = lineNum;
                    part.current = line + '\n';
                }
            } else if (part.startsAt != null && part.endsAt == null && (curlies >= 2 || singleLine)) {
                part.current += line + '\n';
            } else if (part.startsAt != null && part.endsAt == null && curlies == 1) {
                part.endsAt = lineNum;
                part.current += line;
            }

            // Detect the end of a single line function by searching for the ';' because
            // a single line function doesn't necessarily only have one single line.
            if (singleLine && part.startsAt != null && part.endsAt == null && line.trimRight().endsWith(';')) {
                part.endsAt = lineNum;
            }
        }

        return part.isValid ? part : null;
    }

    /**
     * If class already exists and has a constructor with the parameter, reuse that parameter.
     * E.g. when the dev changed the parameter from this.x to this.x = y the generator inserts
     * this.x = y. This way the generator can preserve changes made in the constructor.
     * @param {DartClassProperty | string} prop
     * @param {{ "name": string; "text": string; "isThis": boolean; }[]} oldProps
     */
    findConstrParameter(prop, oldProps) {
        const name = typeof prop === 'string' ? prop : prop.name;
        for (let oldProp of oldProps) {
            if (name === oldProp.name) {
                return oldProp;
            }
        }

        return null;
    }

    /**
     * @param {DartClass} clazz
     */
    findOldConstrProperties(clazz) {
        if (!clazz.hasConstructor || clazz.constrStartsAtLine == clazz.constrEndsAtLine) {
            return [];
        }

        let oldConstr = '';
        let brackets = 0;
        let didFindConstr = false;
        for (let c of clazz.constr) {
            if (c == '(') {
                if (didFindConstr) oldConstr += c;
                brackets++;
                didFindConstr = true;
                continue;
            } else if (c == ')') {
                brackets--;
                if (didFindConstr && brackets == 0)
                    break;
            }

            if (brackets >= 1)
                oldConstr += c;
        }

        oldConstr = removeStart(oldConstr, ['{', '[']);
        oldConstr = removeEnd(oldConstr, ['}', ']']);

        let oldArguments = oldConstr.split('\n');
        const oldProperties = [];
        for (let arg of oldArguments) {
            let formatted = arg.replace('required', '').trim();
            if (formatted.indexOf('=') != -1) {
                formatted = formatted.substring(0, formatted.indexOf('=')).trim();
            }

            let name = null;
            let isThis = false;
            if (formatted.startsWith('this.')) {
                name = formatted.replace('this.', '');
                isThis = true;
            } else {
                const words = formatted.split(' ');
                if (words.length >= 1) {
                    const w = words[1];
                    if (!isBlank(w)) name = w;
                }
            }

            if (name != null) {
                oldProperties.push({
                    "name": removeEnd(name.trim(), ','),
                    "text": arg.trim() + '\n',
                    "isThis": isThis,
                });
            }
        }

        return oldProperties;
    }

    /**
     * @param {DartClass} clazz
     */
    insertConstructor(clazz) {
        const withDefaults = readSetting('constructor.default_values');
        let constr = '';
        let startBracket = '({';
        let endBracket = '})';

        if (clazz.constr != null) {
            if (clazz.constr.trimLeft().startsWith('const'))
                constr += 'const ';

            // Detect custom constructor brackets and preserve them.
            const fConstr = clazz.constr.replace('const', '').trimLeft();

            if (fConstr.startsWith(clazz.name + '([')) startBracket = '([';
            else if (fConstr.startsWith(clazz.name + '({')) startBracket = '({';
            else startBracket = '(';

            if (fConstr.includes('])')) endBracket = '])';
            else if (fConstr.includes('})')) endBracket = '})';
            else endBracket = ')';
        } else {
            if (clazz.isWidget)
                constr += 'const ';
        }


        constr += clazz.name + startBracket + '\n';

        // Add 'Key key,' for widgets in constructor.
        if (clazz.isWidget) {
            let hasKey = false;
            let clazzConstr = clazz.constr || '';
            for (let line of clazzConstr.split('\n')) {
                if (line.trim().startsWith('Key? key')) {
                    hasKey = true;
                    break;
                }
            }

            if (!hasKey)
                constr += '  Key? key,\n';
        }

        const oldProperties = this.findOldConstrProperties(clazz);
        for (let prop of oldProperties) {
            if (!prop.isThis) {
                constr += '  ' + prop.text;
            }
        }

        for (let prop of clazz.properties) {
            const oldProperty = this.findConstrParameter(prop, oldProperties);
            if (oldProperty != null) {
                if (oldProperty.isThis)
                    constr += '  ' + oldProperty.text;

                continue;
            }

            const parameter = `this.${prop.name}`

            constr += '  ';
            if (!prop.isNullable) {
                const hasDefault = withDefaults && ((prop.isPrimitive || prop.isCollection) && prop.rawType != 'dynamic');
                const isNamedConstr = startBracket == '({' && endBracket == '})';

                if (hasDefault) {
                    constr += `${parameter} = ${prop.defValue},\n`;
                } else if (isNamedConstr) {
                    constr += `required ${parameter},\n`;
                } else {
                    constr += `${parameter},\n`;
                }
            } else {
                constr += `${parameter},\n`;
            }
        }

        const stdConstrEnd = () => {
            constr += endBracket + (clazz.isWidget ? ' : super(key: key);' : ';');
        }

        if (clazz.constr != null) {
            let i = null;
            if (clazz.constr.includes(' : ')) i = clazz.constr.indexOf(' : ') + 1;
            else if (clazz.constr.trimRight().endsWith('{')) i = clazz.constr.lastIndexOf('{');

            if (i != null) {
                let ending = clazz.constr.substring(i, clazz.constr.length);
                constr += `${endBracket} ${ending}`;
            } else {
                stdConstrEnd();
            }
        } else {
            stdConstrEnd();
        }

        if (clazz.hasConstructor) {
            clazz.constrDifferent = !areStrictEqual(clazz.constr, constr);
            if (clazz.constrDifferent) {
                constr = removeEnd(indent(constr), '\n');
                this.replace(new ClassPart('constructor', clazz.constrStartsAtLine, clazz.constrEndsAtLine, clazz.constr, constr), clazz);
            }
        } else {
            clazz.constrDifferent = true;
            this.append(constr, clazz, true);
        }
    }

    /**
     * @param {DartClass} clazz
     */
    insertCopyWith(clazz) {
        let method = clazz.type + ' copyWith({\n';
        for (const prop of clazz.properties) {
            method += `  ${prop.type}? ${prop.name},\n`;
        }
        method += '}) {\n';
        method += `  return ${clazz.type}(\n`;

        for (let p of clazz.properties) {
            method += `    ${clazz.hasNamedConstructor ? `${p.name}: ` : ''}${p.name} ?? this.${p.name},\n`;
        }

        method += '  );\n'
        method += '}';

        this.appendOrReplace('copyWith', method, `${clazz.name} copyWith(`, clazz);
    }

    /**
     * @param {DartClass} clazz
     */
    insertToMap(clazz) {
        let props = clazz.properties;
        /**
         * @param {DartClassProperty} prop
         */
        function customTypeMapping(prop, name = null, endFlag = ',\n') {
            prop = prop.isCollection ? prop.listType : prop;
            name = name == null ? prop.name : name;

            const nullSafe = prop.isNullable ? '?' : '';

            switch (prop.rawType) {
                case 'DateTime':
                    return `${name}${nullSafe}.millisecondsSinceEpoch${endFlag}`;
                case 'Color':
                    return `${name}${nullSafe}.value${endFlag}`;
                case 'IconData':
                    return `${name}${nullSafe}.codePoint${endFlag}`
                default:
                    return `${name}${!prop.isPrimitive ? `${nullSafe}.toMap()` : ''}${endFlag}`;
            }
        }

        let method = `Map<String, dynamic> toMap() {\n`;
        method += '  return {\n';
        for (let p of props) {
            method += `    '${p.jsonName}': `;

            if (p.isEnum) {
                method += `${p.name}?.index,\n`;
            } else if (p.isCollection) {
                if (p.isMap || p.listType.isPrimitive) {
                    const mapFlag = p.isSet ? '?.toList()' : '';
                    method += `${p.name}${mapFlag},\n`;
                } else {
                    method += `${p.name}?.map((x) => ${customTypeMapping(p, 'x', '')})?.toList(),\n`
                }
            } else {
                method += customTypeMapping(p);
            }
            if (p.name == props[props.length - 1].name) method += '  };\n';
        }
        method += '}';

        this.appendOrReplace('toMap', method, 'Map<String, dynamic> toMap()', clazz);
    }

    /**
     * @param {DartClass} clazz
     */
    insertFromMap(clazz) {
        let withDefaultValues = readSetting('fromMap.default_values');
        let props = clazz.properties;
        const fromJSON = this.fromJSON;

        /**
         * @param {DartClassProperty} prop
         */
        function customTypeMapping(prop, value = null) {
            prop = prop.isCollection ? prop.listType : prop;
            const addDefault = withDefaultValues && prop.rawType != 'dynamic';
            const endFlag = value == null ? ',\n' : '';
            value = value == null ? "map['" + prop.jsonName + "']" : value;

            switch (prop.type) {
                case 'DateTime':
                    return `DateTime.fromMillisecondsSinceEpoch(${value})${endFlag}`;
                case 'Color':
                    return `Color(${value})${endFlag}`;
                case 'IconData':
                    return `IconData(${value}, fontFamily: 'MaterialIcons')${endFlag}`
                default:
                    return `${!prop.isPrimitive ? prop.type + '.fromMap(' : ''}${value}${!prop.isPrimitive ? ')' : ''}${fromJSON ? (prop.isDouble ? '?.toDouble()' : prop.isInt ? '?.toInt()' : '') : ''}${addDefault && !prop.isNullable ? ` ?? ${prop.defValue}` : ''}${endFlag}`;
            }
        }

        let method = `factory ${clazz.name}.fromMap(Map<String, dynamic> map) {\n`;

        method += '  return ' + clazz.type + '(\n';
        for (let p of props) {
            method += `    ${clazz.hasNamedConstructor ? `${p.name}: ` : ''}`;

            const value = `map['${p.jsonName}']`;
            if (p.isEnum) {
                const defaultValue = withDefaultValues ? ' ?? 0' : '';
                method += `${p.rawType}.values[${value}${defaultValue}],\n`;
            } else if (p.isCollection) {
                const defaultValue = withDefaultValues ? ` ?? const ${p.isList ? '[]' : '{}'}` : '';

                method += `${p.type}.from(`;
                if (p.isPrimitive) {
                    method += `${value}${defaultValue}),\n`;
                } else {
                    method += `${value}?.map((x) => ${customTypeMapping(p, 'x')})${defaultValue}),\n`;
                }
            } else {
                method += customTypeMapping(p);
            }

            const isLast = p.name == props[props.length - 1].name;
            if (isLast) method += '  );\n';
        }
        method += '}';

        this.appendOrReplace('fromMap', method, `factory ${clazz.name}.fromMap(Map<String, dynamic> map)`, clazz);
    }

    /**
     * @param {DartClass} clazz
     */
    insertToJson(clazz) {
        this.requiresImport('dart:convert');

        const method = 'String toJson() => json.encode(toMap());';
        this.appendOrReplace('toJson', method, 'String toJson()', clazz);
    }

    /**
     * @param {DartClass} clazz
     */
    insertFromJson(clazz) {
        this.requiresImport('dart:convert');

        const method = `factory ${clazz.name}.fromJson(String source) => ${clazz.name}.fromMap(json.decode(source));`;
        this.appendOrReplace('fromJson', method, `factory ${clazz.name}.fromJson(String source)`, clazz);
    }

    /**
     * @param {DartClass} clazz
     */
    insertToString(clazz) {
        if (clazz.usesEquatable || readSetting('useEquatable')) {
            let stringify = '@override\n';
            stringify += 'bool get stringify => true;'

            this.appendOrReplace('stringify', stringify, 'bool get stringify', clazz);
        } else {
            const short = clazz.fewProps;
            const props = clazz.properties;
            let method = '@override\n';
            method += `String toString() ${!short ? '{\n' : '=>'}`;
            method += `${!short ? '  return' : ''} '` + `${clazz.name}(`;
            for (let p of props) {
                const name = p.name;
                const isFirst = name == props[0].name;
                const isLast = name == props[props.length - 1].name;

                if (!isFirst)
                    method += ' ';

                method += name + ': $' + name + ',';

                if (isLast) {
                    method = removeEnd(method, ',');
                    method += ")';" + (short ? '' : '\n');
                }
            }
            method += !short ? '}' : '';

            this.appendOrReplace('toString', method, 'String toString()', clazz);
        }
    }

    /**
     * @param {DartClass} clazz
     */
    insertEquality(clazz) {
        const props = clazz.properties;
        const hasCollection = props.find((p) => p.isCollection) != undefined;

        let collectionEqualityFn;
        if (hasCollection) {
            // Flutter already has collection equality functions 
            // in the foundation package.
            if (this.isFlutter) {
                this.requiresImport('package:flutter/foundation.dart');
            } else {
                this.requiresImport('package:collection/collection.dart');

                collectionEqualityFn = 'collectionEquals';
                const isListOnly = props.find((p) => p.isCollection && !p.isList) == undefined;
                if (isListOnly) collectionEqualityFn = 'listEquals';
                const isMapOnly = props.find((p) => p.isCollection && !p.isMap) == undefined;
                if (isMapOnly) collectionEqualityFn = 'mapEquals';
                const isSetOnly = props.find((p) => p.isCollection && !p.isSet) == undefined;
                if (isSetOnly) collectionEqualityFn = 'setEquals';
            }
        }

        let method = '@override\n';
        method += 'bool operator ==(Object other) {\n';
        method += '  if (identical(this, other)) return true;\n';
        if (hasCollection && !this.isFlutter)
            method += `  final ${collectionEqualityFn} = const DeepCollectionEquality().equals;\n`
        method += '\n';
        method += '  return other is ' + clazz.type + ' &&\n';
        for (let prop of props) {
            if (prop.isCollection) {
                if (this.isFlutter) collectionEqualityFn = prop.isSet ? 'setEquals' : prop.isMap ? 'mapEquals' : 'listEquals';
                method += `    ${collectionEqualityFn}(other.${prop.name}, ${prop.name})`;
            } else {
                method += `    other.${prop.name} == ${prop.name}`;
            }
            if (prop.name != props[props.length - 1].name) method += ' &&\n';
            else method += ';\n';
        }
        method += '}';

        this.appendOrReplace('equality', method, 'bool operator ==', clazz);
    }

    /**
     * @param {DartClass} clazz
     */
    insertHash(clazz) {
        const useJenkins = readSetting('hashCode.use_jenkins');
        const short = !useJenkins && clazz.fewProps;
        const props = clazz.properties;
        let method = '@override\n';
        method += `int get hashCode ${short ? '=>' : '{\n  return '}`;

        if (useJenkins) {
            // dart:ui import is required for Jenkins hash.
            this.requiresImport('dart:ui', [
                'package:flutter/material.dart',
                'package:flutter/cupertino.dart',
                'package:flutter/widgets.dart'
            ]);

            method += `hashList([\n`;
            for (let p of props) {
                method += '    ' + p.name + `,\n`;
            }
            method += '  ]);';
        } else {
            for (let p of props) {
                const isFirst = p == props[0];
                method += `${isFirst && !short ? '' : short ? ' ' : '    '}${p.name}.hashCode`;
                if (p == props[props.length - 1]) {
                    method += ';';
                } else {
                    method += ` ^${!short ? '\n' : ''}`;
                }
            }
        }

        if (!short) method += '\n}';

        this.appendOrReplace('hashCode', method, 'int get hashCode', clazz);
    }

    /**
     * @param {DartClass} clazz
     */
    addEquatableDetails(clazz) {
        // Do not generate Equatable for class with 'Base' in their
        // names as Base classes should inherit from Equatable.
        // see: https://github.com/BendixMa/Dart-Data-Class-Generator/issues/8
        if (clazz.hasSuperclass && clazz.superclass.includes('Base')) return;

        this.requiresImport('package:equatable/equatable.dart');

        if (!clazz.usesEquatable) {
            if (clazz.hasSuperclass) {
                this.addMixin('EquatableMixin');
            } else {
                this.setSuperClass('Equatable');
            }
        }
    }

    /**
     * @param {DartClass} clazz
     */
    insertEquatable(clazz) {
        this.addEquatableDetails(clazz);

        const props = clazz.properties;
        const short = props.length <= 4;
        const split = short ? ', ' : ',\n';
        let method = '@override\n';
        method += `List<Object> get props ${!short ? '{\n' : '=>'}`;
        method += `${!short ? '  return' : ''} ` + '[' + (!short ? '\n' : '');
        for (let prop of props) {
            const isLast = prop.name == props[props.length - 1].name;
            const inset = !short ? '    ' : '';
            method += inset + prop.name + split;

            if (isLast) {
                if (short) method = removeEnd(method, split);
                method += (!short ? '  ' : '') + '];' + (!short ? '\n' : '');
            }
        }
        method += !short ? '}' : '';

        this.appendOrReplace('props', method, 'List<Object> get props', clazz);
    }

    /**
     * @param {string} mixin
     */
    addMixin(mixin) {
        const mixins = this.clazz.mixins;
        if (!mixins.includes(mixin)) {
            mixins.push(mixin);
        }
    }

    /**
     * @param {string} impl
     */
    addInterface(impl) {
        const interfaces = this.clazz.interfaces;
        if (!interfaces.includes(impl)) {
            interfaces.push(impl);
        }
    }

    /**
     * @param {string} clazz
     */
    setSuperClass(clazz) {
        this.clazz.superclass = clazz;
    }

    /**
     * @param {string} name
     * @param {string} n
     * @param {string} finder
     * @param {DartClass} clazz
     */
    appendOrReplace(name, n, finder, clazz) {
        let part = this.findPart(name, finder, clazz);
        let replacement = removeEnd(indent(n.replace('@override\n', '')), '\n');

        if (part != null) {
            part.replacement = replacement;
            if (!areStrictEqual(part.current, part.replacement)) {
                this.replace(part, clazz);
            }
        } else {
            this.append(n, clazz);
        }
    }

    /**
     * @param {string} method
     * @param {DartClass} clazz
     */
    append(method, clazz, constr = false) {
        let met = indent(method);
        constr ? clazz.constr = met : clazz.toInsert += '\n' + met;
    }

    /**
     * @param {ClassPart} part
     * @param {DartClass} clazz
     */
    replace(part, clazz) {
        clazz.toReplace.push(part);
    }

    /**
     * @param {string} text
     */
    parseAndReadClasses(text=null) {
        let clazzes = [];
        if (!text) return clazzes;

        let clazz = new DartClass();

        let lines = text.split('\n');
        let curlyBrackets = 0;
        let brackets = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;
            // Make sure to look for 'class ' with the space in order to allow
            // fields that contain the word 'class' as in classifier.
            // issue: https://github.com/BendixMa/Dart-Data-Class-Generator/issues/2
            const classLine = line.trimLeft().startsWith('class ') || line.trimLeft().startsWith('abstract class ');

            if (classLine) {
                clazz = new DartClass();
                clazz.startsAtLine = lineNumber;

                let classNext = false;
                let extendsNext = false;
                let implementsNext = false;
                let mixinsNext = false;

                // Reset brackets count when a new class was detected.
                curlyBrackets = 0;
                brackets = 0;

                const words = this.splitWhileMaintainingGenerics(line);
                for (let word of words) {
                    word = word.trim();
                    if (word.length > 0) {
                        if (word == 'class') {
                            classNext = true;
                        } else if (word == 'extends') {
                            extendsNext = true;
                        } else if (extendsNext) {
                            extendsNext = false;
                            clazz.superclass = word;
                        } else if (word == 'with') {
                            mixinsNext = true;
                            extendsNext = false;
                            implementsNext = false;
                        } else if (word == 'implements') {
                            mixinsNext = false;
                            extendsNext = false;
                            implementsNext = true;
                        } else if (classNext) {
                            classNext = false;

                            // Remove generics from class name.
                            if (word.includes('<')) {
                                clazz.fullGenericType = word.substring(
                                    word.indexOf('<'),
                                    word.lastIndexOf('>') + 1,
                                );

                                word = word.substring(0, word.indexOf('<'));
                            }

                            clazz.name = word;
                        } else if (mixinsNext) {
                            const mixin = removeEnd(word, ',').trim();

                            if (mixin.length > 0) {
                                clazz.mixins.push(mixin);
                            }
                        } else if (implementsNext) {
                            const impl = removeEnd(word, ',').trim();


                            if (impl.length > 0) {
                                clazz.interfaces.push(impl);
                            }
                        }
                    }
                }

                // Do not add State<T> classes of widgets.
                if (!clazz.isState) {
                    clazzes.push(clazz);
                }
            }

            if (clazz.classDetected) {
                // Check if class ended based on bracket count. If all '{' have a '}' pair,
                // class can be closed.
                curlyBrackets += count(line, '{');
                curlyBrackets -= count(line, '}');
                // Count brackets, e.g. to find the constructor.
                brackets += count(line, '(');
                brackets -= count(line, ')');

                // Detect beginning of constructor by looking for the class name and a bracket, while also
                // making sure not to falsely detect a function constructor invocation with the actual 
                // constructor with boilerplaty checking all possible constructor options.
                const includesConstr = line.replace('const', '').trimLeft().startsWith(clazz.name + '(');
                if (includesConstr && !classLine) {
                    clazz.constrStartsAtLine = lineNumber;
                }

                if (clazz.constrStartsAtLine != null && clazz.constrEndsAtLine == null) {
                    clazz.constr = clazz.constr == null ? line + '\n' : clazz.constr + line + '\n';

                    // Detect end of constructor.
                    if (brackets == 0) {
                        clazz.constrEndsAtLine = lineNumber;
                        clazz.constr = removeEnd(clazz.constr, '\n');
                    }
                }

                clazz.classContent += line;
                // Detect end of class.
                if (curlyBrackets != 0) {
                    clazz.classContent += '\n';
                } else {
                    clazz.endsAtLine = lineNumber;
                    clazz = new DartClass();
                }

                if (brackets == 0 && curlyBrackets == 1) {
                    // Check if a line is valid to only include real properties.
                    const lineValid =
                        // Line shouldn't start with the class name as this would
                        // be the constructor or an error.
                        !line.trimLeft().startsWith(clazz.name) &&
                        // Ignore comments.
                        !line.trimLeft().startsWith('//') &&
                        // These symbols would indicate that this is not a field.
                        !includesOne(line, ['{', '}', '=>', '@'], false) &&
                        // Filter out some keywords.
                        !includesOne(line, ['static', 'set', 'get', 'return', 'factory']) &&
                        // Do not include final values that are assigned a value.
                        !includesAll(line, ['final ', '=']) &&
                        // Do not inlcude non final fields that were declared after the constructor.
                        (clazz.constrStartsAtLine == null || line.includes('final ')) &&
                        // Make sure not to catch abstract functions.
                        !line.replace(/\s/g, '').endsWith(');');

                    if (lineValid) {
                        let type = null;
                        let name = null;
                        let isFinal = false;
                        let isConst = false;

                        const words = line.trim().split(' ');
                        for (let i = 0; i < words.length; i++) {
                            const word = words[i];
                            const isLast = i == words.length - 1;

                            if (word.length > 0 && word != '}' && word != '{') {
                                if (word == 'final') {
                                    isFinal = true;
                                } else if (i == 0 && word == 'const') {
                                    isConst = true;
                                }

                                // Be sure to not include keywords.
                                if (word != 'final' && word != 'const') {
                                    // If word ends with semicolon => variable name, else type.
                                    let isVariable = word.endsWith(';') || (!isLast && (words[i + 1] == '='));
                                    // Make sure we don't capture abstract functions like: String func();
                                    isVariable = isVariable && !includesOne(word, ['(', ')']);
                                    if (isVariable) {
                                        if (name == null)
                                            name = removeEnd(word, ';');
                                    } else {
                                        if (type == null) type = word;
                                        // Types can have gaps => Pair<A, B>,
                                        // thus append word to type if a name hasn't
                                        // been detected.
                                        else if (name == null) type += ' ' + word;
                                    }
                                }
                            }
                        }

                        if (type != null && name != null) {
                            const prop = new DartClassProperty(type, name, lineNumber, isFinal, isConst);

                            if (i > 0) {
                                const prevLine = lines[i - 1];
                                prop.isEnum = prevLine.match(/.*\/\/(\s*)enum/) != null;
                            }

                            clazz.properties.push(prop);
                        }
                    }
                }
            }
        }

        return clazzes;
    }

    /**
     * This function is for parsing the class name line while maintaining
     * also more complex generic types like class A<A, List<C>>.
     * 
     * @param {string} line
     */
    splitWhileMaintainingGenerics(line) {
        let words = [];
        let index = 0;
        let generics = 0;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const isCurly = char == '{';
            const isSpace = char == ' ';

            if (char == '<') generics++;
            if (char == '>') generics--;

            if (generics == 0 && (isSpace || isCurly)) {
                const word = line.substring(index, i).trim();

                // Do not add whitespace.
                if (word.length == 0) continue;
                const isOnlyGeneric = word.startsWith('<');

                // Append the generic type to the word when there is spacing
                // between them. E.g.: class Hello <A, B>
                if (isOnlyGeneric) {
                    words[words.length - 1] = words[words.length - 1] + word;
                } else {
                    words.push(word);
                }

                if (isCurly) {
                    break;
                }

                index = i;
            }
        }

        return words;
    }
}

module.exports = {
    DataClassGenerator,
}