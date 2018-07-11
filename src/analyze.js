const rd = require('./rd');

class Analyze {
    constructor(vscode) {
        this.vscode = vscode;

        this.files = this.getFiles();
        
        setInterval(() => {
            this.files = this.getFiles();
        }, 30 * 60 * 1000);
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

    get rootPath() {
        return this.filename.replace(/\/app\/.*/g, '');
    }

    isNodeModules(path) {
        return /\bnode_modules\b/.test(path);
    }

    isPackageJson(path) {
        return /\bpackage\.json\b/.test(path);
    }

    getFiles() {
        const files = [];
        const { rootPath } = this.vscode.workspace;

        rd.eachFileFilterSync(`${rootPath}/app`, /\w+\.\w+$/, file => files.push(file));

        return files;
    }

    getNodeModuleFiles() {
        const files = [];
        const list = this.filename.split('/');
        const length = list.length;
        let index = list.indexOf('node_modules') + 1;
        let path, file;

        do {
            index += 1;
            path = list.slice(0, index).join('/');
            file = [path, '/', 'package.json'].join('');
        } while (!rd.isFile(file) && index < length);

        rd.eachFileFilterSync(`${path}`, /\w+\.\w+$/, file => files.push(file));

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
        const re = /([\w\$]+\s*[\.\-\/]\s*)*[\w\$]+/g;

        const { character } = this.position;
        const lineText = this.getPositionLine();
        //const lineText = linStr.replace(/\//g, '.');
        const lineLen = lineText.split(/\n/g)[0].length;
        const length = lineLen + character;

        lineText.replace(re, (word, p1, index) => {
            if (!text && index > length) {
                text = lastText || word;
            }

            lastText = word;
        });

        text = text || lastText;

        const nmStr = `(require|from)\\s*\\(\\s*['"]@?${text}['"]\\s*\\)`;
        const nmRe = new RegExp(nmStr);

        lineText.replace(nmRe, word => {
            text = word.replace(/.*\(\s*['"]|['"]\s*\).*/g, '');
            text = ['node_modules', '/', text].join('');
        });

        text = text.replace(/\s/g, '');

        return text;
    }

    getTextProps() {
        const text = this.getPositionText();
        const list = text.split('.');
        const funName = list.length > 1 ? list.pop() : '';
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
        let files = this.files;

        if (this.isNodeModules(this.filename)) {
            files = this.getNodeModuleFiles();
        }

        path && files.forEach(file => {
            const text = file.replace(/_[a-z]/g, word => word.slice(1).toUpperCase());

            if (re.test(text) || re.test(file)) {
                list.push(file);
            }

        });

        if (!funName && this.isNodeModules(path)) {
            list.push([this.rootPath, '/', path, '/', 'package.json'].join(''));
        }

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

            try {
                await workspace
                    .openTextDocument(Uri.file(filePath))
                    .then(doc => {
                        if (!doc) {
                            return;
                        }

                        if (this.isPackageJson(filePath)) {
                            const packge = JSON.parse(doc.getText());
                            const main = packge.main || 'index.js';
                            const nmPath = filePath.replace('package.json', main);

                            fileList.push({ path: nmPath });
                            return;
                        }

                        const isFile = re.test(filePath);

                        if (isFile) {
                            fileList.push({ doc });
                            return;
                        }

                        if (!funName) {
                            return;
                        }

                        const text = doc.getText();
                        const name = funName.replace(/(\$)/g, '\\$');

                        const funReText = [
                            `\\b${name}\\b\\s*=?\\s*(async\\s*)?`,
                            `(function\\s*\\*?\\s*\\([^\\)]*\\)|\\([^\\)]*\\)|\\w+)(\\s*=>)?`,
                            `\\s*{|function\\s*\\*?\\s+${name}\\s*\\([^\\)]*\\)\\s*{`
                        ].join('');

                        const funIndex = text.split(new RegExp(funReText))[0].length;

                        if (funIndex === text.length) {
                            return;
                        }

                        //funIndex = funIndex + 1;

                        const nameStart = doc.positionAt(funIndex);
                        const nameEnd = doc.positionAt(funIndex + funName.length);
                        const nameRange = new vscode.Range(nameStart, nameEnd);

                        const defineStart = doc.positionAt(text.lastIndexOf('}', funIndex));
                        const defineEnd = doc.positionAt(text.indexOf('\n\n', funIndex));
                        const defineRange = new vscode.Range(defineStart, defineEnd);
                        const defineText = doc.getText(defineRange);

                        codeList.push({ doc, nameRange, defineText });
                    });
            } catch (e) { }
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
        const { workspace, Uri } = vscode;
        const { doc, path } = fileProps;

        if (doc) {
            vscode.window.showTextDocument(doc, { preview: false });
        } else if (path) {
            workspace
                .openTextDocument(Uri.file(path))
                .then(doc => {
                    vscode.window.showTextDocument(doc, { preview: false });
                });
        }
    }
}

module.exports = Analyze;
