const vscode = require('vscode');

const {DartClassReader} = require('../readers/dart_class_reader');
const {JsonReader} = require('../readers/json_reader');

const {DataClassGenerator} = require('../data_class_generator');

const {
    DartClass,
} = require('../types');

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

const {camelCase} = require('change-case'); // This introduces the largest penalty in startup time (10 ms, worth checking to understand it better)

/**
 * @param {DartClass[]} theClasses
 */
 async function showClassChooser(theClasses) {
    const values = theClasses.map((theClass) => theClass.name);

    const response = await vscode.window.showQuickPick(values, {
        placeHolder: 'Please select the classes you want to generate data classes of.',
        canPickMany: true,
    });

    let result = [];
    if (response != null && response.length > 0) {
        for (let selectedClass of response) {
            for (let aClass of theClasses) {
                if (aClass.name == selectedClass)
                    result.push(aClass);
            }
        }
    } else return null;

    return result;
}

/**
 * @param {boolean} isFlutter
 * @param {string} projectName
 */
async function generateDataClass(isFlutter, projectName, text = getDocText()) {
  console.log(`asdf ${camelCase('arriba la vida')}`)
    if (getLangId() == 'dart') {
        const reader = new DartClassReader(text, null, projectName);
        const generator = new DataClassGenerator(reader.theClasses, reader.imports,false, isFlutter, projectName);
        let theClasses = generator.clazzes;

        if (theClasses.length == 0) {
            showError('No convertible dart classes were detected!');
            return null;
        } else if (theClasses.length >= 2) {
            // Show a prompt if there is more than one class in the current editor.
            theClasses = await showClassChooser(theClasses);
            if (theClasses == null) {
                showInfo('No classes selected!');
                return;
            }
        }

        for (let aClass of theClasses) {
            if (aClass.isValid && aClass.toReplace.length > 0) {
                if (readSetting('override.manual')) {
                    // When manual overriding is activated ask for every override.
                    let result = [];
                    for (let replacement of aClass.toReplace) {
                        const r = await vscode.window.showQuickPick(['Yes', 'No'], {
                            placeHolder: `Do you want to override ${replacement.name}?`,
                            canPickMany: false
                        });

                        if (r == null) {
                            showInfo('Canceled!');
                            return;
                        } else if ('Yes' == r) result.push(replacement);
                    }
                    aClass.toReplace = result;
                }
            }
        }

        await vscode.workspace.applyEdit(getReplaceEdit(theClasses, generator.imports, true));
        clearSelection();

        // console.log(theClasses);
        return theClasses;
    } else {
        showError('Make sure that you\'re editing a dart file and then try again!');
        return null;
    }
}


/**
 * @param {boolean} isFlutter
 * @param {string} projectName
 */
async function generateDataClassFromJson(isFlutter, projectName) {
    let langId = getLangId();
    if (langId == 'dart') {
        let documentText = getDocText();

        const name = await vscode.window.showInputBox({
            placeHolder: 'Please type in a class name.'
        });

        if (name == null || name.length == 0) {
            return;
        }

        let reader = new JsonReader(isFlutter, projectName, documentText, name);
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

/**
 * @param {boolean} isFlutter
 * @param {string} projectName
 */
 async function generateDataClassFromJsonWithTemplate(isFlutter, projectName) {
    // If there are templates, then go ahead
    let templates = readSetting('templates') || [];
    if (!templates.length) {
      return showError("No configured templates found!");
    }

    // Select a template
    let selectedTemplate = null;
    if (templates.length == 1) {
      selectedTemplate = templates[0];

      const response = await vscode.window.showQuickPick(['Yes', 'No'], {
          canPickMany: false,
          placeHolder: `Template '${selectedTemplate.name}' selected automatically. Do you want to proceed?`
      });

      if (response != null) {
          if (response == 'No') {
              return showInfo('Class generation cancelled');
          }
      } else {
          return;
      }
    } else {
      let selectedTemplateName = await vscode.window.showQuickPick(
        templates.map((template) => template.name), {
            canPickMany: false,
            placeHolder: `Please select the template you want to use for class generation`
        }
      );
      selectedTemplate = templates.find(temp => temp.name === selectedTemplateName);
    }

    console.warn(`Selected template ${selectedTemplate.name}`)
    console.log(selectedTemplate)

    // With the template selected, we are ready to proceed (parseJSON -> apply template)


    // let langId = getLangId();
    // if (langId == 'dart') {
    //     let documentText = getDocText();

    //     const name = await vscode.window.showInputBox({
    //         placeHolder: 'Please type in a class name.'
    //     });

    //     if (name == null || name.length == 0) {
    //         return;
    //     }

    //     let reader = new JsonReader(isFlutter, projectName, documentText, name);
    //     let separate = true;

    //     if (await reader.error == null) {
    //         if (reader.files.length >= 2) {
    //             const setting = readSetting('json.separate');
    //             if (setting == 'ask') {
    //                 const r = await vscode.window.showQuickPick(['Yes', 'No'], {
    //                     canPickMany: false,
    //                     placeHolder: 'Do you wish to separate the JSON into multiple files?'
    //                 });

    //                 if (r != null) {
    //                     separate = r == 'Yes';
    //                 } else {
    //                     return;
    //                 }
    //             } else {
    //                 separate = (setting == 'separate');
    //             }
    //         }

    //         vscode.window.withProgress({
    //             location: vscode.ProgressLocation.Notification,
    //             cancellable: false
    //         }, async function (progress, token) {
    //             progress.report({ increment: 0, message: 'Generating Data Classes...' });
    //             scrollTo(0);
    //             await reader.commitJson(progress, separate);
    //             clearSelection();
    //         });
    //     } else {
    //         showError(await reader.error);
    //     }
    // } else if (langId == 'json') {
    //     showError('Please paste the JSON directly into an empty .dart file and then try again!');
    // } else {
    //     showError('Make sure that you\'re editing a dart file and then try again!');
    // }
}

module.exports = {
    generateDataClass,
    generateDataClassFromJson,
    generateDataClassFromJsonWithTemplate,
}