const vscode = require('vscode');

const {
    DataClassCodeActions,
} = require('./actions/actions');
const {
    isFlutterProject,
    getProjectName,
} = require('./helpers');

const{
    generateDataClass,
    generateJsonDataClass,
} = require('./commands/commands');

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate (context) {
    const isFlutter = await isFlutterProject();
    const projectName = await getProjectName();

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'dart_data_class.generate.from_props',
            () => {
                generateDataClass(isFlutter, projectName);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'dart_data_class.generate.from_json',
            () => {
                generateJsonDataClass(isFlutter, projectName);
            }
        )
    );

    context.subscriptions.push(vscode.languages.registerCodeActionsProvider({
        language: 'dart',
        scheme: 'file'
    }, new DataClassCodeActions(isFlutter, projectName), {
        providedCodeActionKinds: [
            vscode.CodeActionKind.QuickFix
        ],
    }));
}

/**
* @param {string} source
* @param {string[]} matches
*/
function removeAll(source, matches) {
    let r = '';
    for (let s of source) {
        if (!matches.includes(s)) {
            r += s;
        }
    }
    return r;
}

function deactivate() { }

module.exports = {
    activate,
    deactivate,
    removeAll,
}
