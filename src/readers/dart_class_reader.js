const {
    DartClass,
    ClassPart,
    Imports,
    DartClassProperty,
} = require('../types');

const {
    removeEnd,
} = require('../helpers');



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
 * Returns the number of times 'match' appears in 'source'
 *
 * @param {string} source
 * @param {string} match
 */
function count(source, match) {
    return source.split(match).length - 1;
}

const normalizeWithoutGenerics = (src) => {
    let result = '';
    let generics = 0;
    let prevChar = '';
    for (const char of src) {
        if (char == '<') generics++;
        if (char != ' ' && generics == 0) {
            result += char;
        }

        if (char == '>' && prevChar != '=') generics--;
        prevChar = char;
    }

    return result;
}

/**
 * The Reader looks at Dart code to generate a representation of the `class` being analyzed
 * 
 * As such, it doesn't care about project structure or parts. It is equivalent to the JSON reader, but from Dart code
 */
class DartClassReader {
    /**
     * @param {string} text
     * @param {DartClass[]} theClasses
     * @param {string} projectName
     */
    constructor(text, theClasses = null, projectName = null) {
        this.theClasses = theClasses == null ? this.parseClasses(text) : theClasses;
        this.imports = new Imports(text, projectName);
    }

    /**
     * Reads a Dart class definition and maps it to a DartClass representation
     * It relies on the consistent use of `dart format`
     * 
     * @param {string} text
     */
    parseClasses(text = null) {
        let theClasses = [];
        if (!text) return theClasses;

        let aClass = null;
        let aPart = null;
        let aPartIsArrowSyntax = false;
        let curlyBrackets = 0;
        let brackets = 0;

        let lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;
            // Make sure to look for 'class ' with the space in order to allow
            // fields that contain the word 'class' as in classifier.
            // issue: https://github.com/BendixMa/Dart-Data-Class-Generator/issues/2
            const classDefinitionLine = line.trimLeft().startsWith('class ') || line.trimLeft().startsWith('abstract class ');

            if (classDefinitionLine) {
                aClass = new DartClass();
                aClass.abstract = line.trimLeft().startsWith('abstract class ');
                aClass.startsAt = lineNumber;

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
                        } else if (word == 'with') {
                            mixinsNext = true;
                            extendsNext = implementsNext = false;
                        } else if (word == 'implements') {
                            implementsNext = true;
                            extendsNext = mixinsNext = false;
                        } else if (classNext) {
                            classNext = false;
                            // Clean class name from generics
                            if (word.includes('<')) {
                                aClass.fullGenericType = word.substring(
                                    word.indexOf('<'),
                                    word.lastIndexOf('>') + 1,
                                );

                                word = word.substring(0, word.indexOf('<'));
                            }

                            aClass.name = word;
                        } else if (extendsNext) {
                            extendsNext = false;
                            aClass.superclass = word;
                        } else if (mixinsNext) {
                            const mixin = removeEnd(word, ',').trim();
                            if (mixin.length > 0) aClass.mixins.push(mixin);
                        } else if (implementsNext) {
                            const impl = removeEnd(word, ',').trim();
                            if (impl.length > 0) aClass.interfaces.push(impl);
                        }
                    }
                }

                // Do not add State<T> classes of widgets.
                if (!aClass.isState) {
                    theClasses.push(aClass);
                }
            }

            if (aClass) {
                // Check if class ended based on curly bracket count. If all '{' have a '}' pair,
                // class can be closed.
                curlyBrackets += count(line, '{');
                curlyBrackets -= count(line, '}');
                // Count brackets, e.g. to find the constructor.
                brackets += count(line, '(');
                brackets -= count(line, ')');

                // HACK: considering the constructor beginning here instead of at the common section until matchPart is updated
                // Detect beginning of constructor by looking for the class name and a bracket, while also
                // making sure not to falsely detect a function constructor invocation with the actual 
                // constructor with boilerplaty checking all possible constructor options.
                const classConstructorLine = line.replace('const', '').trimLeft().startsWith(aClass.name + '(');
                if (!classDefinitionLine && classConstructorLine) {
                    aPart = new ClassPart('constructor', 'constructor');
                    aPart.startsAt = lineNumber
                }

                let partIdentifiers = this.matchPart(aClass, line);
                if (aPart == null && partIdentifiers[0] != null) {
                    if (line.includes('=>'))
                        aPartIsArrowSyntax = true;

                    aPart = new ClassPart(partIdentifiers[0], partIdentifiers[1]);
                    aPart.startsAt = lineNumber
                }
                if (aPart) {
                    aPart.current += line + '\n'; // HACK: Might not be needed in the future

                    if (!aPartIsArrowSyntax && curlyBrackets == 1) {
                        aPart.endsAt = lineNumber
                        aPart.current = removeEnd(aPart.current, '\n'); // ???: Not sure
                        aClass.initialParts.push(aPart)
                        aPart = null
                    }
                    if (aPartIsArrowSyntax && line.trimRight().endsWith(';')) {
                        aPart.endsAt = lineNumber
                        aPart.current = removeEnd(aPart.current, '\n'); // ???: Not sure
                        aClass.initialParts.push(aPart)
                        aPartIsArrowSyntax = false;
                        aPart = null
                    }
                }

                // closing class?
                if (curlyBrackets === 0) {
                    aClass.endsAt = lineNumber;
                    // if (aClass != null) {
                    //     console.warn(`previously had class: ${aClass.name} with ${aClass.initialParts.length} parts detected`)
                    // }
                    aClass = null;
                }


                if (brackets == 0 && curlyBrackets == 1) {
                    // Check if a line is valid to only include real properties.
                    const lineValid =
                        // Ignore comments.
                        !line.trimLeft().startsWith('/') &&
                        // Line shouldn't start with the class name as this would
                        // be the constructor or an error.
                        !line.trimLeft().startsWith(aClass.name) &&
                        // These symbols would indicate that this is not a field.
                        !includesOne(line, ['{', '}', '=>', '@'], false) &&
                        // Filter out some keywords.
                        !includesOne(line, ['static', 'set', 'get', 'return', 'factory']) &&
                        // Do not include final values that are assigned a value.
                        !includesAll(line, ['final ', '=']) &&
                        // Do not include non final fields that were declared after the constructor.
                        (!aClass.hasConstructor || line.includes('final ')) &&
                        // Make sure not to catch abstract functions.
                        !line.replace(/\s/g, '').endsWith(');');

                    if (lineValid) {
                        let propertyType = null;
                        let propertyName = null;
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
                                        if (propertyName == null)
                                            propertyName = removeEnd(word, ';');
                                    } else {
                                        if (propertyType == null) propertyType = word;
                                        // Types can include whitespace, e.g. Pair<A, B>,
                                        // thus append word to propertyType if a propertyName hasn't
                                        // been detected yet.
                                        else if (propertyName == null) propertyType += ' ' + word;
                                    }
                                }
                            }
                        }

                        if (propertyType != null && propertyName != null) {
                            const prop = new DartClassProperty(propertyType, propertyName, lineNumber, isFinal, isConst);

                            if (i > 0) {
                                // Check if it is an `enum` based on previous line comment
                                // See https://github.com/bnxm/dart-data-class-generator/issues/19
                                const prevLine = lines[i - 1];
                                prop.isEnum = prevLine.match(/.*\/\/(\s*)enum/) != null;
                            }

                            aClass.properties.push(prop);
                        }
                    }
                }
            }
        }

        return theClasses;
    }


    // TODO: Identify part match on the reader for constructor ?
    /**
     * 
     * @param {DartClass} clazz 
     * @param {string} line 
     * @returns [string, string]
     */
    matchPart(clazz, line) {
        let finderStrings = new Map([
            [`${clazz.name} copyWith(`, ['copyWith', 'copyWith']],
            ['Map<String, dynamic> toMap()', ['toMap', 'serialization']],
            [`factory ${clazz.name}.fromMap(Map<String, dynamic> map)`, ['fromMap', 'serialization']],
            ['String toJson()', ['toJson', 'serialization']],
            [`factory ${clazz.name}.fromJson(String source)`, ['fromJson', 'serialization']],
            ['bool get stringify', ['stringify', 'toString']],
            ['String toString()', ['toString', 'toString']],
            ['bool operator ==', ['equality', 'equality']],
            ['int get hashCode', ['hashCode', 'equality']],
            ['List<Object> get props', ['props', 'useEquatable']],
        ]);

        for (const [finderString, identifiers] of finderStrings) {
            if ( normalizeWithoutGenerics(line).startsWith(normalizeWithoutGenerics(finderString)) ) {
                return identifiers;
            }      
        }
        return [null, null]
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
                    words[words.length - 1] += word;
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
    DartClassReader,
}