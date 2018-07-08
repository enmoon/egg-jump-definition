const vscode = require('vscode');
const Analyze = require('./analyze');

const analyze = new Analyze(vscode);

async function activate(context) {

    let disposableLbs = vscode.commands.registerCommand('extension.egg-jump-definition', async function () {
        await analyze.lbs();
    });

    // let disposableHover = vscode.languages.registerHoverProvider('javascript', {
    //     provideHover() {
    //         return new Promise(async (resolve, reject) => {
    //             const weights = await analyze.getWeights();

    //             if (!weights) {
    //                 reject();
    //                 return;
    //             }

    //             const { codeList } = weights;
    //             const code = codeList[0];

    //             if (code) {
    //                 const defineText = code.defineText;
    //                 resolve(new vscode.Hover(defineText));
    //                 console.log('final to code');
    //                 return;
    //             }

    //             reject();
    //             //new vscode.Hover(definition);
    //         });
    //     }
    // });

    context.subscriptions.push(disposableLbs);
    //context.subscriptions.push(disposableHover);
}

exports.activate = activate;


function deactivate() {

}

exports.deactivate = deactivate;