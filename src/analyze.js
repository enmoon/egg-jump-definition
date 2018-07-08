let fileList = [];
const rd = require('rd');


class Analyze {
    constructor(vscode) {
        this.vscode = vscode;

        this.files = this.getFiles();
    }

    get document() {
        return this.vscode.window.activeTextEditor.document;
    }

    get selection() {
        return this.vscode.window.activeTextEditor.selection;
    }

    get position() {
        return this.vscode.window.activeTextEditor.selection.active;
    }

    get filename() {
        return this.vscode.window.activeTextEditor.document.fileName;
    }

    getFiles() {
        const files = [];
        const { rootPath } = this.vscode.workspace;

        rd.eachFileFilterSync(`${rootPath}/app`, /\w+\.\w+$/, file => files.push(file));

        return files;
    }

    getPositionLine() {
        const { vscode, position, document } = this;
        const { line } = position;
        const start = new vscode.Position(line > 0 ? line - 1 : line, 0);
        const end = new vscode.Position(line + 2, 0);

        return document.getText(new vscode.Range(start, end));
    }

    getPositionText() {
        let text = '';
        let lastText = '';
        const re = /((\w|\$)+\s*\.\s*)+(\w|\$)+/g;
        const { character } = this.position;
        const linStr = this.getPositionLine();
        const lineText = linStr.replace(/\//g, '.');
        const lineLen = lineText.split(/\n/g)[0].length;
        const length = lineLen + character;

        lineText.replace(re, (word, p1, p2, p3, index) => {
            if (!text && index > length) {
                text = lastText || word;
            }

            lastText = word;
        });

        text = text || lastText;
        text = text.replace(/\s/g, '');

        return text;
    }

    getTextProps() {
        const text = this.getPositionText();
        const list = text.split('.');
        const funName = list.pop();
        const path = list.join('/');

        return {
            path,
            funName
        }
    }

    getPathProps() {
        const props = this.getTextProps();
        const { path, funName } = props;
        const constantRe = /\b(this|ctx|app)\b\/?/g;
        const pathText = path.replace(constantRe, word => {
            return `(${word})?`;
        });
        const suffix = `(/${funName})?(\\.${funName}|\\.\\w+)?`;
        const re = new RegExp(`${pathText}${suffix}\$`, 'g');
        const list = [this.filename];



        path && this.files.forEach(file => {
            const text = file.replace(/_[a-z]/g, word => word.slice(1).toUpperCase());

            if (re.test(text) || re.test(file)) {
                list.push(file);
            }

        });

        return {
            list,
            path,
            funName
        }
    }

    async lbs() {
        const weights = await this.getWeights();

        if (!weights) {
            return;
        }

        const { codeList, fileList } = weights;
        const code = codeList[0];
        const file = fileList[0];

        if (code) {
            this.toCode(code);
        } else if (file) {
            this.toFile(file);
        }
    }

    async getWeights() {
        const { vscode } = this;
        const { workspace, Uri } = vscode;
        const { list, path, funName } = this.getPathProps();
        //const re = new RegExp([path, '/', funName, '(\\.\\w+)\?$'].join(''), 'g');
        const re = new RegExp(`${path}(\\.${funName}|/${funName}\\.\\w+)`, 'g');
        const codeList = [];
        const fileList = [];

        if (list.length === 0) {
            console.log('filePath is undefind!');
            return;
        }

        for (const filePath of list) {

            if (codeList.concat(fileList).length) {
                break;
            }

            await workspace
                .openTextDocument(Uri.file(filePath))
                .then(doc => {
                    if (!doc) {
                        return;
                    }

                    const isFile = re.test(filePath);

                    if (isFile) {
                        fileList.push({ doc });
                        return;
                    }

                    const text = doc.getText();
                    const name = funName.replace(/(\$)/g, '\\$');
                    let funIndex = text.split(new RegExp('(?:[^.])\\b' + name + '\\b[^;\n]+{'))[0].length;

                    if (funIndex === text.length) {
                        return;
                    }

                    funIndex = funIndex + 1;

                    const nameStart = doc.positionAt(funIndex);
                    const nameEnd = doc.positionAt(funIndex + funName.length);
                    const nameRange = new vscode.Range(nameStart, nameEnd);

                    const defineStart = doc.positionAt(text.lastIndexOf('}', funIndex));
                    const defineEnd = doc.positionAt(text.indexOf('\n\n', funIndex));
                    const defineRange = new vscode.Range(defineStart, defineEnd);
                    const defineText = doc.getText(defineRange);

                    codeList.push({ doc, nameRange, defineText });
                });

        }

        return {
            codeList,
            fileList
        }
    }

    toCode(fileProps) {
        const { vscode } = this;
        const { doc, nameRange, defineText } = fileProps;

        vscode.window.showTextDocument(doc, { preview: false, selection: nameRange }).then(document => {
            //vscode.window.createTextEditorDecorationType({ textDecoration: 'underline' });
            // nameRange && document.revealRange(nameRange);
            // new vscode.Hover(defineText);
        });
    }

    toFile(fileProps) {
        const { vscode } = this;
        const { doc } = fileProps;

        doc && vscode.window.showTextDocument(doc, { preview: false });
    }
}

module.exports = Analyze;