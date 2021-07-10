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
* @param {string} match
*/
function count(source, match) {
    return source.split(match).length - 1;
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
     * @param {DartClass[]} clazzes
     * @param {Imports} imports
     * @param {boolean} fromJSON
     * @param {boolean} isFlutter
     * @param {string} projectName
     */
    constructor(clazzes, imports = null, fromJSON = false, isFlutter = false, projectName = null) {
        this.fromJSON = fromJSON;
        this.clazzes = clazzes;
        this.isFlutter = isFlutter;
        this.projectName = projectName;
        this.imports = imports || new Imports('', projectName);
        this.generateDataClazzes();
    }

    /**
     * @param {string} imp
     * @param {string[]} validOverrides
     */
    requiresImport(imp, validOverrides = []) {
        this.imports.requiresImport(imp, validOverrides);
    }

    // All parts are generated by this class, because the source is unique and saves reprocessing
    generateDataClazzes() {
        for (let clazz of this.clazzes) {
            if (readSetting('constructor.enabled') ) // part = constructor
                this.insertConstructor(clazz);

            if (!clazz.isWidget) {
                if (!clazz.isAbstract) {
                    if (readSetting('copyWith.enabled') ) // part = copyWith
                        this.insertCopyWith(clazz);
                    if (readSetting('toMap.enabled') ) // part = serialization
                        this.insertToMap(clazz);
                    console.warn('inserting FROM MAP')
                    if (readSetting('fromMap.enabled') ) // part = serialization
                        this.insertFromMap(clazz);
                    console.warn('inserting TO JSON')
                    if (readSetting('toJson.enabled') ) // part = serialization
                        this.insertToJson(clazz);
                    console.warn('inserting FROM JSON')
                    if (readSetting('fromJson.enabled') ) // part = serialization
                        this.insertFromJson(clazz);
                }

                if (readSetting('toString.enabled') ) // part = toString
                    this.insertToString(clazz);

                if (clazz.usesEquatable || readSetting('useEquatable')) { // part = useEquatable
                    this.insertEquatable(clazz);
                } else {
                    if (readSetting('equality.enabled') ) // part = equality
                        this.insertEquality(clazz);
                    if (readSetting('hashCode.enabled') ) // part = equality
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
     REMOVEfindPartInSourceCode(name, groupName, finder, clazz) {
        console.log(`looking for part ${name} with finder ${finder}`)
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
        const lines = clazz.initialSourceCode.split('\n');
        const part = new ClassPart(name, groupName);
        let curlies = 0;
        let singleLine = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = clazz.startsAt + i;

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
        if (!clazz.hasConstructor ){ //|| clazz.constrStartsAtLine == clazz.constrEndsAtLine) {
            return [];
        }

        let oldConstr = '';
        let brackets = 0;
        let didFindConstr = false;
        let constr = clazz.findPart('constructor').current;
        for (let c of constr) {
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

        let currentConstr = clazz.hasConstructor? clazz.findPart('constructor').current : null;

        if (currentConstr != null) {
            if (currentConstr.trimLeft().startsWith('const'))
                constr += 'const ';

            // Detect custom constructor brackets and preserve them.
            const fConstr = currentConstr.replace('const', '').trimLeft();

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
            let clazzConstr = currentConstr || '';
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

        if (currentConstr != null) {
            let i = null;
            if (currentConstr.includes(' : ')) i = currentConstr.indexOf(' : ') + 1;
            else if (currentConstr.trimRight().endsWith('{')) i = currentConstr.lastIndexOf('{');

            if (i != null) {
                let ending = currentConstr.substring(i, currentConstr.length);
                constr += `${endBracket} ${ending}`;
            } else {
                stdConstrEnd();
            }
        } else {
            stdConstrEnd();
        }

        // if (clazz.hasConstructor) {
        //     clazz.constrDifferent = !areStrictEqual(clazz.constr, constr);
        //     if (clazz.constrDifferent) {
        //         console.log('constructor is different')
        //         constr = removeEnd(indent(constr), '\n');
        //         this.replace(new ClassPart('constructor', clazz.constrStartsAtLine, clazz.constrEndsAtLine, clazz.constr, constr), clazz);
        //     }
        // } else {
        //     clazz.constrDifferent = true;
        //     this.append(constr, clazz, true);
        // }

        this.appendOrReplace('constructor', 'constructor', constr, `${clazz.name}${startBracket}`, clazz);

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

        this.appendOrReplace('copyWith', 'copyWith', method, `${clazz.name} copyWith(`, clazz);
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

        this.appendOrReplace('toMap', 'serialization', method, 'Map<String, dynamic> toMap()', clazz);
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

        this.appendOrReplace('fromMap', 'serialization', method, `factory ${clazz.name}.fromMap(Map<String, dynamic> map)`, clazz);
    }

    /**
     * @param {DartClass} clazz
     */
    insertToJson(clazz) {
        this.requiresImport('dart:convert');

        const method = 'String toJson() => json.encode(toMap());';
        this.appendOrReplace('toJson', 'serialization', method, 'String toJson()', clazz);
    }

    /**
     * @param {DartClass} clazz
     */
    insertFromJson(clazz) {
        this.requiresImport('dart:convert');

        const method = `factory ${clazz.name}.fromJson(String source) => ${clazz.name}.fromMap(json.decode(source));`;
        this.appendOrReplace('fromJson', 'serialization', method, `factory ${clazz.name}.fromJson(String source)`, clazz);
    }

    /**
     * @param {DartClass} clazz
     */
    insertToString(clazz) {
        if (clazz.usesEquatable || readSetting('useEquatable')) {
            let stringify = '@override\n';
            stringify += 'bool get stringify => true;'

            this.appendOrReplace('stringify', 'toString', stringify, 'bool get stringify', clazz);
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

            this.appendOrReplace('toString', 'toString', method, 'String toString()', clazz);
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

        this.appendOrReplace('equality', 'equality', method, 'bool operator ==', clazz);
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

        this.appendOrReplace('hashCode', 'equality', method, 'int get hashCode', clazz);
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
                this.addMixin(clazz, 'EquatableMixin');
            } else {
                this.setSuperClass(clazz, 'Equatable');
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

        this.appendOrReplace('props', 'useEquatable', method, 'List<Object> get props', clazz);
    }

    /**
     * @param {DartClass} clazz
     * @param {string} mixin
     */
    addMixin(clazz, mixin) {
        const mixins = clazz.mixins;
        if (!mixins.includes(mixin)) {
            mixins.push(mixin);
        }
    }

    /**
     * @param {DartClass} clazz
     * @param {string} impl
     */
    addInterface(clazz, impl) {
        const interfaces = clazz.interfaces;
        if (!interfaces.includes(impl)) {
            interfaces.push(impl);
        }
    }

    /**
     * @param {DartClass} clazz
     * @param {string} clazzName
     */
    setSuperClass(clazz, clazzName) {
        clazz.superclass = clazzName;
    }

    /**
     * @param {string} partName
     * @param {string} groupName
     * @param {string} n
     * @param {string} finder
     * @param {DartClass} clazz
     */
    appendOrReplace(partName, groupName, n, finder, clazz) {
        // let part = this.findPartInSourceCode(partName, groupName, finder, clazz);
        let part = clazz.findPart(partName, groupName)
        let replacement = removeEnd(indent(n.replace('@override\n', '')), '\n');

        if (part != null) {
            part.replacement = replacement;
            if (!areStrictEqual(part.current, part.replacement)) {
                console.warn(`part ${part.name} is different`)
                this.replace(part, clazz);
            }
        } else {
            this.append(n, clazz, partName, groupName);
        }
    }

    // FIXME: Insert should be processed as text later on. At this point the important part is if the part is to be inserted
    /**
     * @param {string} method
     * @param {DartClass} clazz
     */
    append(method, clazz, partName = null, groupName = null) {
        let met = indent(method);
        // console.log('got the constructor')
        const part = new ClassPart(partName, groupName);
        part.replacement = '\n//Added from append\n' + met;
        clazz.toInsert.push(part);
    }

    /**
     * @param {ClassPart} part
     * @param {DartClass} clazz
     */
    replace(part, clazz) {
        // console.log(`replace ${part.name}`)
        part.replacement = '//Added from replace\n' + part.replacement;
        clazz.toReplace.push(part);
    }
}

module.exports = {
    DataClassGenerator,
}
