const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * @param {number} from
 * @param {number} to
 */
 function scrollTo(from = null, to = null) {
    getEditor().revealRange(
        new vscode.Range(
            new vscode.Position(from || 0, 0),
            new vscode.Position(to || 0, 0)
        ),
        0
    );
}

function clearSelection() {
    getEditor().selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
}

function getEditor() {
    return vscode.window.activeTextEditor;
}

function getDoc() {
    return getEditor().document;
}

function getDocText() {
    return getDoc().getText();
}

function getLangId() {
    return getDoc().languageId;
}

/**
 * @param {string} key
 */
 function readSetting(key) {
    return vscode.workspace.getConfiguration().get('dart_data_class_generator.' + key);
}

/**
 * @param {string[]} keys
 */
function readSettings(keys) {
    for (let key of keys) {
        if (readSetting(key)) {
            return true;
        }
    }

    return false;
}

/**
 * @param {string} msg
 */
 function showError(msg) {
    vscode.window.showErrorMessage(msg);
}

/**
 * @param {string} msg
 */
function showInfo(msg) {
    vscode.window.showInformationMessage(msg);
}

/**
 * @param {string} name
 */
 function createFileName(name) {
    let r = '';
    for (let i = 0; i < name.length; i++) {
        let c = name[i];
        if (c == c.toUpperCase()) {
            if (i == 0) r += c.toLowerCase();
            else r += '_' + c.toLowerCase();
        } else {
            r += c;
        }
    }

    return r;
}

/**
 * @param {string} source
 * @param {string | any[]} start
 */
 function removeStart(source, start) {
    if (Array.isArray(start)) {
        let result = source.trim();
        for (let s of start) {
            result = removeStart(result, s).trim();
        }
        return result;
    } else {
        return source.startsWith(start) ? source.substring(start.length, source.length) : source;
    }
}

/**
 * @param {string} source
 * @param {string | any[]} end
 */
function removeEnd(source, end) {
    if (Array.isArray(end)) {
        let result = source.trim();
        for (let e of end) {
            result = removeEnd(result, e).trim();
        }
        return result;
    } else {
        const pos = (source.length - end.length);
        return source.endsWith(end) ? source.substring(0, pos) : source;
    }
}

/**
 * @param {string} str
 */
 function isBlank(str) {
    return (!str || /^\s*$/.test(str));
}

/**
 * @param {string} a
 * @param {string} b
 */
 function areStrictEqual(a, b) {
    let x = a.replace(/\s/g, "");
    let y = b.replace(/\s/g, "");
    return x === y;
}

/**
 * Make a valid dart variable name from a string.
 * @param {string} source
 */
 function toVarName(source) {
    let s = source;
    let r = '';

    /**
     * @param {string} char
     */
    let replace = (char) => {
        if (s.includes(char)) {
            const splits = s.split(char);
            for (let i = 0; i < splits.length; i++) {
                let w = splits[i];
                i > 0 ? r += capitalize(w) : r += w;
            }
        }
    }

    // Replace invalid variable characters like '-'.
    replace('-');
    replace('~');
    replace(':');
    replace('#');
    replace('$');

    if (r.length == 0)
        r = s;

    // Prevent dart keywords from being used.
    switch (r) {
        case 'assert': r = 'aAssert'; break;
        case 'break': r = 'bBreak'; break;
        case 'case': r = 'cCase'; break;
        case 'catch': r = 'cCatch'; break;
        case 'class': r = 'cClass'; break;
        case 'const': r = 'cConst'; break;
        case 'continue': r = 'cContinue'; break;
        case 'default': r = 'dDefault'; break;
        case 'do': r = 'dDo'; break;
        case 'else': r = 'eElse'; break;
        case 'enum': r = 'eEnum'; break;
        case 'extends': r = 'eExtends'; break;
        case 'false': r = 'fFalse'; break;
        case 'final': r = 'fFinal'; break;
        case 'finally': r = 'fFinally'; break;
        case 'for': r = 'fFor'; break;
        case 'if': r = 'iIf'; break;
        case 'in': r = 'iIn'; break;
        case 'is': r = 'iIs'; break;
        case 'new': r = 'nNew'; break;
        case 'null': r = 'nNull'; break;
        case 'rethrow': r = 'rRethrow'; break;
        case 'return': r = 'rReturn'; break;
        case 'super': r = 'sSuper'; break;
        case 'switch': r = 'sSwitch'; break;
        case 'this': r = 'tThis'; break;
        case 'throw': r = 'tThrow'; break;
        case 'true': r = 'tTrue'; break;
        case 'try': r = 'tTry'; break;
        case 'var': r = 'vVar'; break;
        case 'void': r = 'vVoid'; break;
        case 'while': r = 'wWhile'; break;
        case 'with': r = 'wWith'; break;
    }

    if (r.length > 0 && r[0].match(new RegExp(/[0-9]/)))
        r = 'n' + r;

    return r;
}

/**
 * @param {string} source
 */
 function capitalize(source) {
    let s = source;
    if (s.length > 0) {
        if (s.length > 1) {
            return s.substr(0, 1).toUpperCase() + s.substring(1, s.length);
        } else {
            return s.substr(0, 1).toUpperCase();
        }
    }

    return s;
}

/**
 * @param {string} content
 * @param {string} name
 */
 async function writeFile(content, name, open = true, destinationPath = getCurrentPath()) {
    let p = destinationPath + name + '.dart';
    if (fs.existsSync(p)) {
        let i = 0;
        do {
            p = destinationPath + name + '_' + ++i + '.dart'
        } while (fs.existsSync(p));
    }

    fs.writeFileSync(p, content, 'utf-8');
    if (open) {
        let openPath = vscode.Uri.parse("file:///" + p);
        let doc = await vscode.workspace.openTextDocument(openPath);
        await vscode.window.showTextDocument(doc);
    }
    return;
}


function getCurrentPath() {
    let currentPath = vscode.window.activeTextEditor.document.fileName;
    return path.dirname(currentPath) + path.sep;
}

async function isFlutterProject() {
    const pubspecs = await vscode.workspace.findFiles('pubspec.yaml');
    if (pubspecs != null && pubspecs.length > 0) {
        const pubspec = pubspecs[0];
        const content = fs.readFileSync(pubspec.fsPath, 'utf8');
        if (content != null && content.includes('name: ')) {
            return content.includes('flutter:') && content.includes('sdk: flutter');
        }
    }
    return false;
}

async function getProjectName() {
    const pubspecs = await vscode.workspace.findFiles('pubspec.yaml');
    if (pubspecs != null && pubspecs.length > 0) {
        const pubspec = pubspecs[0];
        const content = fs.readFileSync(pubspec.fsPath, 'utf8');
        if (content != null && content.includes('name: ')) {
            for (const line of content.split('\n')) {
                if (line.startsWith('name: ')) {
                    return line.replace('name:', '').trim();
                }
            }
        }
    }
    return null;
}

module.exports = {
    isFlutterProject,
    getProjectName,
    writeFile,
    getCurrentPath,
    capitalize,
    toVarName,
    areStrictEqual,
    isBlank,
    removeStart,
    removeEnd,
    createFileName,
    scrollTo,
    clearSelection,
    getEditor,
    getDoc,
    getDocText,
    getLangId,
    readSetting,
    readSettings,
    showError,
    showInfo,
}