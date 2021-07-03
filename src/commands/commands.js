const vscode = require('vscode');

const {DataClassGenerator} = require('../data_class_generator');

const {
    DartClass,
} = require('../types');

const {
    JsonReader,
} = require('../json_reader');
const {
    scrollTo,
    clearSelection,
    getDocText,
    getLangId,
    readSetting,
    showError,
    showInfo,
} = require('../helpers');

const {
    getReplaceEdit,
} = require('../editor_helpers');

/**
 * @param {DartClass[]} clazzez
 */
 async function showClassChooser(clazzez) {
    const values = clazzez.map((v) => v.name);

    const r = await vscode.window.showQuickPick(values, {
        placeHolder: 'Please select the classes you want to generate data classes of.',
        canPickMany: true,
    });

    let result = [];
    if (r != null && r.length > 0) {
        for (let c of r) {
            for (let clazz of clazzez) {
                if (clazz.name == c)
                    result.push(clazz);
            }
        }
    } else return null;

    return result;
}

async function generateDataClass(isFlutter, projectName, text = getDocText()) {
    if (getLangId() == 'dart') {
        const generator = new DataClassGenerator(text, null, false, null, isFlutter, projectName);
        let clazzes = generator.clazzes;

        if (clazzes.length == 0) {
            showError('No convertable dart classes were detected!');
            return null;
        } else if (clazzes.length >= 2) {
            // Show a prompt if there is more than one class in the current editor.
            clazzes = await showClassChooser(clazzes);
            if (clazzes == null) {
                showInfo('No classes selected!');
                return;
            }
        }

        for (let clazz of clazzes) {
            if (clazz.isValid && clazz.toReplace.length > 0) {
                if (readSetting('override.manual')) {
                    // When manual overriding is activated ask for every override.
                    let result = [];
                    for (let replacement of clazz.toReplace) {
                        const r = await vscode.window.showQuickPick(['Yes', 'No'], {
                            placeHolder: `Do you want to override ${replacement.name}?`,
                            canPickMany: false
                        });

                        if (r == null) {
                            showInfo('Canceled!');
                            return;
                        } else if ('Yes' == r) result.push(replacement);
                    }
                    clazz.toReplace = result;
                }
            }
        }

        console.log(clazzes);

        const edit = getReplaceEdit(clazzes, generator.imports, true);
        await vscode.workspace.applyEdit(edit);

        clearSelection();

        return clazzes;
    } else {
        showError('Make sure that you\'re editing a dart file and then try again!');
        return null;
    }
}



async function generateJsonDataClass(isFlutter, projectName) {
    let langId = getLangId();
    if (langId == 'dart') {
        let document = getDocText();

        const name = await vscode.window.showInputBox({
            placeHolder: 'Please type in a class name.'
        });

        if (name == null || name.length == 0) {
            return;
        }

        let reader = new JsonReader(isFlutter, projectName, document, name);
        let separate = true;

        if (await reader.error == null) {
            if (reader.files.length >= 2) {
                const setting = readSetting('json.separate');
                if (setting == 'ask') {
                    const r = await vscode.window.showQuickPick(['Yes', 'No'], {
                        canPickMany: false,
                        placeHolder: 'Do you wish to separate the JSON into multiple files?'
                    });

                    if (r != null) {
                        separate = r == 'Yes';
                    } else {
                        return;
                    }
                } else {
                    separate = (setting == 'separate');
                }
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                cancellable: false
            }, async function (progress, token) {
                progress.report({ increment: 0, message: 'Generating Data Classes...' });
                scrollTo(0);
                await reader.commitJson(progress, separate);
                clearSelection();
            });
        } else {
            showError(await reader.error);
        }
    } else if (langId == 'json') {
        showError('Please paste the JSON directly into an empty .dart file and then try again!');
    } else {
        showError('Make sure that you\'re editing a dart file and then try again!');
    }
}


module.exports = {
    generateDataClass,
    generateJsonDataClass,
}