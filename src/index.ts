import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_tools from "jopi-toolkit/jk_tools";
import * as jk_term from "jopi-toolkit/jk_term";

const LOG = false;

//region Helpers

let gProjectRootDir = jk_fs.resolve("sampleProject");
let gGenRootDir = jk_fs.join(gProjectRootDir, "gen");
let gSrcRootDir = jk_fs.join(gProjectRootDir, "src");

async function genWriteFile(filePath: string, fileContent: string): Promise<void> {
    await jk_fs.mkDir(jk_fs.dirname(filePath));
    return jk_fs.writeTextToFile(filePath, fileContent);
}

async function createLink_Import(newFilePath: string, targetFilePath: string) {
    let relPath = jk_fs.getRelativePath(jk_fs.dirname(newFilePath), targetFilePath);
    await genWriteFile(newFilePath, `import D from "${relPath}";\nexport default D;\n`);
}

async function createLink_Symlink(newFilePath: string, targetFilePath: string) {
    await jk_fs.mkDir(jk_fs.dirname(newFilePath));
    await jk_fs.symlink(targetFilePath, newFilePath, "file");
}

async function createImportRef(itemType: string, itemId: string, sourceFilePath: string) {
    const newFilePath = jk_fs.resolve(gGenRootDir, itemType, itemId + ".ts")
    //await createLink_Import(newFilePath, sourceFilePath);
    await createLink_Symlink(newFilePath, sourceFilePath);
}

async function resolveFile(sourceDirPath: string, fileNames: string[]): Promise<string|undefined> {
    for (let fileName of fileNames) {
        let filePath = jk_fs.join(sourceDirPath, fileName);
        if (await jk_fs.isFile(filePath)) return filePath;
    }

    return undefined;
}

function declareError(message: string, filePath: string): Error {
    jk_term.logBgRed("⚠️ Error -", message, "⚠️");
    jk_term.logBlue("See:", jk_fs.pathToFileURL(filePath));
    process.exit(1);
}

//endregion

//region Registry

interface DefineItem {
    uid: string;
    alias?: string;
    entryPoint: string;
    itemType: string;
}

interface ReplaceItem {
    mustReplace: string;
    mustReplaceIsUID: boolean;

    replaceWith: string;
    replaceWithIsUID: boolean;

    priority: PriorityLevel;
    declarationFile: string;
}

const gDefine: Record<string, DefineItem> = {};
const gReplacing: Record<string, ReplaceItem> = {};

function addReplace(mustReplace: string, replaceWith: string, priority: PriorityLevel|undefined, declarationFile: string) {
    if (!priority) priority = PriorityLevel.default;
    let current = gReplacing[mustReplace];

    if (current) {
        if (current.priority>priority) return;
    }

    gReplacing[mustReplace] = {
        declarationFile,
        mustReplace, replaceWith, priority,
        mustReplaceIsUID: jk_tools.isUUIDv4(mustReplace),
        replaceWithIsUID: jk_tools.isUUIDv4(replaceWith)
    };

    if (LOG) console.log("Add REPLACE", mustReplace, "=>", replaceWith, "priority", priority);
}

function addDefine(itemUid: string, itemAlias: string | undefined, entryPoint: string, itemType: string) {
    let entry: DefineItem = {
        uid: itemUid,
        alias: itemAlias,
        entryPoint, itemType
    };

    gDefine[itemUid] = entry;
    if (itemAlias) gDefine[itemAlias] = entry;

    const relPath = jk_fs.getRelativePath(gSrcRootDir, entryPoint);

    if (LOG) {
        console.log("Add DEFINE", itemUid, "=>", relPath);
        if (itemAlias) console.log("Add ALIAS", itemAlias, "=>", itemUid);
    }
}

async function createLinks() {
    async function doDefine(itemId: string, entry: DefineItem) {
        await createImportRef(entry.itemType, itemId, entry.entryPoint);
    }

    for (let mustReplace in gReplacing) {
        let replaceItem = gReplacing[mustReplace];

        let mustReplaceRef = gDefine[mustReplace];
        let replaceWithRef = gDefine[replaceItem.replaceWith];

        if (!mustReplaceRef) {
            if (replaceItem.mustReplaceIsUID) throw declareError("Can't find the UID to replace : " + mustReplace, replaceItem.declarationFile);
            throw declareError("Can't find the alias to replace : " + mustReplace, replaceItem.declarationFile);
        }

        if (!replaceWithRef) {
            if (replaceItem.replaceWithIsUID) throw declareError("Can't find the UID used for replacement : " + replaceItem.replaceWith, replaceItem.declarationFile);
            throw declareError("Can't find the alias used for replacement : " + replaceItem.replaceWith, replaceItem.declarationFile);
        }
    }

    for (let key in gDefine) {
        const entry = gDefine[key];
        await doDefine(key, entry);
    }
}

//endregion

//region Processing dir

interface DirProcessorParams {
    dirPath: string;
    itemsType: string;
    mode: "file"|"dir"|"fileOrDir";
    onItem: ItemHandler;
    resolve?: Record<string, string[]>;
    dontAddMissingUid?: boolean;
}

interface DirProcessorItem {
    itemUid: string;
    itemAlias?: string;

    itemPath: string;
    itemType: string;
    isFile: boolean;
    priority?: PriorityLevel;

    resolved?: Record<string, string|undefined>;
}

type ItemHandler = (props: DirProcessorItem) => Promise<void>;

enum PriorityLevel {
    veryLow = -200,
    low = -100,
    default = 0,
    high = 100,
    veryHigh = 200,
}

async function searchPriorityLevel(baseDir: string): Promise<PriorityLevel | undefined> {
    let priority: PriorityLevel | undefined = undefined;

    let priorityFiles = (await jk_fs.listDir(baseDir)).filter(entry => {
        if (!entry.isFile) return false;

        switch (entry.name) {
            case "priorityVeryHigh":
                priority = PriorityLevel.veryHigh;
                return true;
            case "priorityHigh":
                priority = PriorityLevel.high;
                return true;
            case "priorityDefault":
                priority = PriorityLevel.default;
                return true;
            case "priorityLow":
                priority = PriorityLevel.low;
                return true;
            case "priorityVeryLow":
                priority = PriorityLevel.veryLow;
                return true;
        }

        return false;
    });

    if (priorityFiles.length > 1) {
        throw declareError("More than one priority file declared", baseDir);
    }

    return priority;
}

async function processDir(p: DirProcessorParams) {
    async function processItem(itemPath: string, itemName: string, isFile: boolean) {
        let isUUID = jk_tools.isUUIDv4(itemName);

        if (isFile) {
            if (!isUUID) {
                throw declareError("An UIDis expected", itemPath);
            }

            await p.onItem({
                itemUid: itemName,
                itemPath, isFile,
                itemType: p.itemsType
            });

            return;
        }

        let resolved: Record<string, string | undefined> = {};

        if (p.resolve) {
            for (let key in p.resolve) {
                resolved[key] = await resolveFile(itemPath, p.resolve[key]);
            }
        }

        let uidFiles = (await jk_fs.listDir(itemPath)).filter(entry => {
            if (entry.isFile && entry.name.endsWith(".uid")) {
                if (entry.name==="_.uid") {
                    entry.name = jk_tools.generateUUIDv4() + ".uid";
                    jk_fs.rename(entry.fullPath, jk_fs.join(jk_fs.dirname(entry.fullPath), entry.name));
                }

                return entry.fullPath;
            }
        });

        let itemUid: string;
        let itemAlias: string | undefined;

        if (isUUID) {
            itemUid = itemName;

            if (uidFiles.length) {
                throw declareError("A UID file is found here but not expected", itemPath);
            }
        }
        else {
            itemAlias = itemName;

            if (uidFiles.length > 1) {
                throw declareError("More than one UID file declared", itemPath);
            }

            if (uidFiles.length) {
                itemUid = jk_fs.basename(uidFiles[0].fullPath, ".uid");

                // Add the uid into the file name.
                // Will allow full text search.
                //
                await jk_fs.writeTextToFile(uidFiles[0].fullPath, itemUid);
            } else {
                if (!p.dontAddMissingUid) {
                    itemUid = jk_tools.generateUUIDv4();
                    await jk_fs.writeTextToFile(jk_fs.join(itemPath, itemUid + ".uid"), itemUid);
                }
                else {
                    itemUid = "";
                }
            }
        }

        const priority: PriorityLevel|undefined = await searchPriorityLevel(itemPath);

        await p.onItem({
            itemUid, itemAlias, itemPath, isFile, resolved, priority,
            itemType: p.itemsType
        });
    }

    let dirContent = await jk_fs.listDir(p.dirPath);

    for (let entry of dirContent) {
        if (!await checkDirItem(entry)) continue

        if (p.mode === "file") {
            if (entry.isFile) {
                await processItem(entry.fullPath, entry.name, true);
            }
        } else if (p.mode === "dir") {
            if (entry.isDirectory) {
                await processItem(entry.fullPath, entry.name, false);
            }
        } else if (p.mode === "fileOrDir") {
            await processItem(entry.fullPath, entry.name, entry.isFile===true);
        }
    }
}

//endregion

//region Processing project

async function processProject() {
    await jk_fs.rmDir(gGenRootDir);
    await processModules();
    await createLinks();
}

async function processModules() {
    let modules = await jk_fs.listDir(gSrcRootDir);

    for (let module of modules) {
        if (!module.isDirectory) continue;
        await processModule(module.fullPath);
    }
}

async function processModule(moduleDir: string) {
    await processDefinesDir(moduleDir);
    await processReplacesDir(moduleDir);
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
                if (!props.resolved?.entryPoint) {
                    throw declareError("No 'index.ts' or 'index.tsx' file found", props.itemPath);

                }

                addDefine(props.itemUid, props.itemAlias, props.resolved.entryPoint, props.itemType);
            }
        });
    }
}

async function processReplacesDir(moduleDir: string) {
    let itemTypes = await jk_fs.listDir(jk_fs.join(moduleDir, "@replaces"));

    for (let itemType of itemTypes) {
        if ((itemType.name[0]==='_') || (itemType.name[0]==='.')) continue;

        await processDir({
            dirPath: itemType.fullPath,
            itemsType: itemType.name,
            mode: "fileOrDir",
            dontAddMissingUid: true,

            onItem: async (props) => {
                if (props.itemUid && props.itemAlias) {
                    throw declareError("An item can't have both an UID and an alias", jk_fs.join(props.itemPath, props.itemUid + ".uid"));
                }

                // Here we are in the directory of the item to replace.
                let items = await jk_fs.listDir(props.itemPath);

                let isFound = false;

                for (let item of items) {
                    if (!await checkDirItem(item)) continue;

                    if (isFound) {
                        throw declareError("More than one item to replace found",  props.itemPath);
                    }

                    let priority: PriorityLevel|undefined;

                    if (!item.isFile) {
                        priority = await searchPriorityLevel(item.fullPath);
                    }

                    addReplace(props.itemAlias || props.itemUid, item.name, priority, props.itemPath);
                    isFound = true;
                }
            }
        });
    }
}

async function checkDirItem(entry: jk_fs.DirItem) {
    if (!entry.isFile && !entry.isDirectory) return false;

    // _ allows generating an UID replacing the item.
    if (entry.name === "_") {
        let uid = jk_tools.generateUUIDv4();
        let newPath = jk_fs.join(jk_fs.dirname(entry.fullPath), uid);
        await jk_fs.rename(entry.fullPath, newPath);
        entry.fullPath = newPath;
        entry.name = uid;
    }

    // Underscore allows disabling the item.
    return !((entry.name[0] === "_") || (entry.name[0] === "."));
}

//endregion

await processProject();