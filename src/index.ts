import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_tools from "jopi-toolkit/jk_tools";

//region Helpers

let gProjectRootDir = jk_fs.resolve("sampleProject");
let gGenRootDir = jk_fs.join(gProjectRootDir, "gen");
let gSrcRootDir = jk_fs.join(gProjectRootDir, "src");

async function genWriteFile(filePath: string, fileContent: string): Promise<void> {
    await jk_fs.mkDir(jk_fs.dirname(filePath));
    return jk_fs.writeTextToFile(filePath, fileContent);
}

async function genAddDirAlias(pathInsideGenDir: string, sourceDir: string): Promise<void> {
    let dirPath = jk_fs.join(gGenRootDir, pathInsideGenDir);

    if (await jk_fs.isDirectory(sourceDir)) {
        await jk_fs.symlink(sourceDir, dirPath);
    }
}

async function addImportAlias(newFilePath: string, targetFilePath: string) {
    let relPath = jk_fs.getRelativePath(jk_fs.dirname(newFilePath), targetFilePath);
    await genWriteFile(newFilePath, `import D from "${relPath}";\nexport default D;\n`);
}

async function declareUid(uid: string, sourceDirPath: string, itemType: string) {
    console.log("Add items [" + itemType + "] with id", uid);

    const newFilePath = jk_fs.resolve(gGenRootDir, itemType, uid + ".ts")
    await addImportAlias(newFilePath, jk_fs.join(sourceDirPath, "index.tsx"));
}

//endregion

//region Processing dir

interface DirProcessorParams {
    dirPath: string;
    itemsType: string;
    resolveMode: "file"|"dir";
    onItem: ItemHandler;
}

interface DirProcessorItem {
    itemPath: string;
    itemType: string;
    itemUid: string;
}

type ItemHandler = (props: DirProcessorItem) => Promise<void>;

async function processDir(p: DirProcessorParams) {
    async function processItem(itemPath: string) {
        await p.onItem({
            itemPath,
            itemType: p.itemsType,
            itemUid: jk_fs.basename(itemPath)
        });
    }

    if (!await jk_fs.isDirectory(p.dirPath)) return;

    let dirContent = await jk_fs.listDir(p.dirPath);

    for (let entry of dirContent) {
        // _ allows generating an UID replacing the item.
        if (entry.name === "_") {
            let uid = jk_tools.generateUUIDv4();
            let newPath = jk_fs.join(p.dirPath, uid);
            await jk_fs.rename(entry.fullPath, jk_fs.join(p.dirPath, uid));
            entry.fullPath = newPath;
            entry.name = uid;
        }

        // Underscore allows disabling the item.
        if ((entry.name[0]==="_") || (entry.name[0]===".")) continue;

        if (p.resolveMode === "file") {
            if (entry.isFile) {
                await processItem(entry.fullPath);
            }
        } else {
            if (entry.isDirectory) {
                await processItem(entry.fullPath);
            }
        }
    }
}

//endregion

async function processModules() {
    let modules = await jk_fs.listDir(gSrcRootDir);

    for (let module of modules) {
        if (!module.isDirectory) continue;
        await processModule(module.fullPath);
    }
}

async function processModule(moduleDir: string) {
    await processDefinesDir(moduleDir);
}

async function processDefinesDir(moduleDir: string) {
    let itemTypes = await jk_fs.listDir(jk_fs.join(moduleDir, "@defines"));

    for (let itemType of itemTypes) {
        if ((itemType.name[0]==='_') || (itemType.name[0]==='.')) continue;

        await processDir({
            dirPath: itemType.fullPath,
            itemsType: itemType.name,
            resolveMode: "dir",

            onItem: async (props) => {
                await declareUid(props.itemUid, props.itemPath, props.itemType);
            }
        });
    }
}

async function test1() {
    await processModules();
}

await test1();