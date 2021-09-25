const nls = require('vscode-nls');
let localize = nls.config({ locale: 'en-GB' })();

const vscode = require('vscode');

const {
  DataClassCodeActions,
} = require('./actions/actions');
const {
  characterizeProject,
} = require('./helpers');

const {
  generateDataClass,
  generateDataClassFromJson,
  generateDataClassFromJsonWithTemplate,
} = require('./commands/commands');

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
  const [isFlutter, projectName] = await characterizeProject();

  var msg = localize('hello.hello', 'very first hello')
  console.log(msg);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'dart-data-o-matic.generate.from_props',
      () => {
        generateDataClass(isFlutter, projectName);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'dart-data-o-matic.generate.from_json',
      () => {
        generateDataClassFromJson(isFlutter, projectName);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'dart-data-o-matic.generate.from_json_with_template',
      () => {
        generateDataClassFromJsonWithTemplate(isFlutter, projectName);
      }
    )
  );
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider({
    language: 'dart',
    scheme: 'file',
  }, new DataClassCodeActions(isFlutter, projectName), {
    providedCodeActionKinds: [
      vscode.CodeActionKind.QuickFix,
    ],
  }));
}

function deactivate() { }

module.exports = {
  activate,
  deactivate,
}
