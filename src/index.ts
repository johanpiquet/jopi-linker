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

async function addImportAlias(newFilePath: string, targetFilePath: string) {
    let relPath = jk_fs.getRelativePath(jk_fs.dirname(newFilePath), targetFilePath);
    await genWriteFile(newFilePath, `import D from "${relPath}";\nexport default D;\n`);
}

async function declareUid(uid: string, sourceFilePath: string, itemType: string) {
    console.log("Add items [" + itemType + "] with id", uid);

    const newFilePath = jk_fs.resolve(gGenRootDir, itemType, uid + ".ts")
    await addImportAlias(newFilePath, sourceFilePath);
}

async function resolveFile(sourceDirPath: string, fileNames: string[]): Promise<string|undefined> {
    for (let fileName of fileNames) {
        let filePath = jk_fs.join(sourceDirPath, fileName);
        if (await jk_fs.isFile(filePath)) return filePath;
    }

    return undefined;
}

//endregion

//region Processing dir

interface DirProcessorParams {
    dirPath: string;
    itemsType: string;
    mode: "file"|"dir"|"list";
    onItem: ItemHandler;
    resolve?: Record<string, string[]>;
}

interface DirProcessorItem {
    itemPath: string;
    itemType: string;
    itemUid: string;
    priority?: PriorityLevel;
    resolved?: Record<string, string|undefined>;
}

type ItemHandler = (props: DirProcessorItem) => Promise<void>;
type PriorityLevel = "default"|"veryHigh"|"high"|"low"|"veryLow";

async function processDir(p: DirProcessorParams) {
    async function processFile(itemPath: string) {
        await p.onItem({
            itemPath,
            itemType: p.itemsType,
            itemUid: jk_fs.basename(itemPath)
        });
    }

    async function processDir(itemPath: string) {
        let resolved: Record<string, string | undefined> = {};

        if (p.resolve) {
            for (let key in p.resolve) {
                resolved[key] = await resolveFile(itemPath, p.resolve[key]);
            }
        }

        /*let uidFiles = (await jk_fs.listDir(itemPath)).filter(entry => {
            if (entry.isFile && entry.name.endsWith(".uid")) {
                return entry.fullPath;
            }
        });*/

        let priority: PriorityLevel = "default";

        let priorityFiles = (await jk_fs.listDir(itemPath)).filter(entry => {
            if (!entry.isFile) return false;

            switch (entry.name) {
                case "priorityVeryHigh":
                case "priorityHigh":
                case "priorityDefault":
                case "priorityLow":
                case "priorityVeryLow":
                    priority = entry.name.substring(8) as PriorityLevel;
                    return true;
            }

            return false;
        });

        if (priorityFiles.length>1) {
            throw "Error - More than one priority file declared here: " + itemPath;
        }

        await p.onItem({
            itemPath, resolved,
            itemType: p.itemsType,
            itemUid: jk_fs.basename(itemPath),
            priority
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

        if (p.mode === "file") {
            if (entry.isFile) {
                await processFile(entry.fullPath);
            }
        } else if (p.mode === "dir") {
            if (entry.isDirectory) {
                await processDir(entry.fullPath);
            }
        } else if (p.mode === "list") {
            // Directories forming a list.
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
            mode: "dir",

            resolve: {
                "info": ["info.json"],
                "entryPoint": ["index.tsx", "index.ts"]
            },

            onItem: async (props) => {
                if (props.resolved?.entryPoint) {
                    await declareUid(props.itemUid, props.resolved.entryPoint, itemType.name);
                }
            }
        });
    }
}

async function test1() {
    await processModules();
}

await test1();