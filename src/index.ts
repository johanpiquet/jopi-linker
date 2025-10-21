import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_tools from "jopi-toolkit/jk_tools";
import * as jk_term from "jopi-toolkit/jk_term";

const LOG = true;

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

function addNameIntoFile(filePath: string) {
    jk_fs.writeTextToFile(filePath, jk_fs.basename(filePath)).catch();
}

//endregion

//region Registry

interface DefineItem {
    uid: string;
    alias: string[];
    entryPoint: string;
    itemCategory: string;
    itemPath: string;
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

function addDefine(itemUid: string, itemAlias: string[], entryPoint: string, itemCategory: string, itemPath: string) {
    if (gDefine[itemUid]) {
        throw declareError("The UID " + itemUid + " is already defined", gDefine[itemUid].itemPath);
    }

    for (let alias of itemAlias) {
        if (gDefine[alias]) {
            throw declareError("The alias " + alias + " is already defined", itemPath);
        }
    }

    let entry: DefineItem = {
        uid: itemUid, alias: itemAlias,
        entryPoint, itemCategory, itemPath
    };

    gDefine[itemUid] = entry;
    for (let alias of itemAlias) gDefine[alias] = entry;

    const relPath = jk_fs.getRelativePath(gSrcRootDir, entryPoint);

    if (LOG) {
        console.log("Add DEFINE", itemUid, "=>", relPath);
        for (let alias of itemAlias) console.log("Add ALIAS", alias, "=>", itemUid);
    }
}

async function createLinks() {
    async function doDefine(itemId: string, entry: DefineItem) {
        await createImportRef(entry.itemCategory, itemId, entry.entryPoint);
    }

    for (let mustReplace in gReplacing) {
        let replaceItem = gReplacing[mustReplace];

        let mustReplaceRef = gDefine[mustReplace];
        let replaceWithRef = gDefine[replaceItem.replaceWith];

        if (!mustReplaceRef) {
            let message =   "Can't find the UID to replace : " + mustReplace +
                            "\nCheck that the item is declared in a @defines clause";

            if (replaceItem.mustReplaceIsUID) {
                throw declareError(message, replaceItem.declarationFile);
            }

            message = message.replace("UID", "alias");
            throw declareError(message, replaceItem.declarationFile);
        }

        if (!replaceWithRef) {
            if (replaceItem.replaceWithIsUID) throw declareError("Can't find the UID used for replacement : " + replaceItem.replaceWith, replaceItem.declarationFile);
            throw declareError("Can't find the alias used for replacement : " + replaceItem.replaceWith, replaceItem.declarationFile);
        }

        gDefine[mustReplace] = replaceWithRef;
    }

    for (let key in gDefine) {
        const entry = gDefine[key];
        await doDefine(key, entry);
    }
}

async function getSortedDirItem(dirPath: string): Promise<jk_fs.DirItem[]> {
    const items = await jk_fs.listDir(dirPath);
    return items.sort((a, b) => a.name.localeCompare(b.name));
}
//endregion

//region Processing dir

interface DirProcessorParams {
    dirToScan: string;
    dirToScan_expectFsType: "file"|"dir"|"fileOrDir";
    dirToScan_nameConstraint: "canBeUid"|"mustNotBeUid"|"mustBeUid";

    childDir_filesToResolve?: Record<string, string[]>;
    childDir_requireMyUidFile?: boolean;
    childDir_errorIfMyUidFile?: boolean;
    childDir_createMissingMyUidFile?: boolean;

    childDir_requireRefFile?: boolean;

    itemProcessor: ItemHandler;
    itemCategory: string;
}

interface DirProcessorItem {
    itemName: string;
    itemUid?: string;
    itemAlias: string[];
    refFile?: string;

    itemPath: string;
    itemCategory: string;
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
    function setPriority(level: PriorityLevel) {
        if (priority) throw declareError("More than one priority file declared", baseDir);
        priority = level;
    }

    let priority: PriorityLevel | undefined = undefined;

    (await jk_fs.listDir(baseDir)).forEach(entry => {
        if (!entry.isFile) return false;
        if (!entry.name.startsWith("priority")) return false;

        entry.name = entry.name.toLowerCase();
        entry.name = entry.name.replace("-", "");
        entry.name = entry.name.replace("_", "");

        switch (entry.name) {
            case "priorityveryhigh":
                setPriority(PriorityLevel.veryHigh);
                break;
            case "priorityhigh":
                setPriority(PriorityLevel.high);
                break;
            case "prioritydefault":
                setPriority(PriorityLevel.default);
                break;
            case "prioritylow":
                setPriority(PriorityLevel.low);
                break;
            case "priorityverylow":
                setPriority(PriorityLevel.veryLow);
                break;
        }
    });

    return priority;
}

async function processDir(p: DirProcessorParams) {
    /**
     * This function extracts information about the item,
     * do some check, and call `p.onItem` with the informations.
     */
    async function processDirItem(itemPath: string, itemName: string, isFile: boolean) {
        // The file / folder-name is a UUID4?
        let isUUID = jk_tools.isUUIDv4(itemName);

        if (isUUID) {
            if (p.dirToScan_nameConstraint==="mustNotBeUid") {
                throw declareError("The name must NOT be an UID", itemPath);
            }
        } else {
            if (p.dirToScan_nameConstraint==="mustBeUid") {
                throw declareError("The name MUST be an UID", itemPath);
            }
        }

        // It's a file?
        if (isFile) {
            if (p.childDir_requireMyUidFile && !isUUID) {
                throw declareError("The file name MUST be an UID", itemPath);
            }

            // Process it now.
            await p.itemProcessor({
                itemName,
                itemUid: isUUID ? itemName : undefined,
                itemAlias: [],

                itemPath, isFile,
                itemCategory: p.itemCategory
            });

            return;
        }

        // Will search references to config.json / index.tsx / ...
        //
        let resolved: Record<string, string | undefined> = {};
        //
        if (p.childDir_filesToResolve) {
            for (let key in p.childDir_filesToResolve) {
                resolved[key] = await resolveFile(itemPath, p.childDir_filesToResolve[key]);
            }
        }

        let itemUid: string|undefined;

        // Search the "uid.myuid" file, which allows knowing the uid of the item.
        //
        (await jk_fs.listDir(itemPath)).forEach(entry => {
            if (entry.isFile && entry.name.endsWith(".myuid")) {
                if (itemUid) {
                    throw declareError("More than one UID file declared", entry.fullPath);
                }

                // "_.myduid" is a special file name, which is automatically renamed with a new uid.
                // Is used to help the developer to avoid generating himself a new uid.
                //
                if (entry.name==="_.myuid") {
                    entry.name = jk_tools.generateUUIDv4() + ".myuid";
                    jk_fs.rename(entry.fullPath, jk_fs.join(jk_fs.dirname(entry.fullPath), entry.name));
                }

                itemUid = jk_fs.basename(entry.name, ".myuid");
                addNameIntoFile(entry.fullPath);

                return entry.fullPath;
            }
        });

        if (!itemUid) {
            // > Not "ui.myuid" found? Then add it.

            if (p.childDir_createMissingMyUidFile) {
                itemUid = jk_tools.generateUUIDv4();
                await jk_fs.writeTextToFile(jk_fs.join(itemPath, itemUid + ".myuid"), itemUid);
            }
        }

        let itemAlias: string[] = [];

        // Search the alias.
        (await jk_fs.listDir(itemPath)).forEach(entry => {
            if (entry.isFile && entry.name.endsWith(".alias")) {
                itemAlias.push(jk_fs.basename(entry.name, ".alias"));
                addNameIntoFile(entry.fullPath);
            }
        });

        // Search the ref file.
        let refFile: string|undefined;
        //
        (await jk_fs.listDir(itemPath)).forEach(entry => {
            if (entry.isFile && entry.name.endsWith(".ref")) {
                if (refFile) throw declareError("More than one .ref file found", itemPath);
                refFile = jk_fs.basename(entry.name, ".ref");
                addNameIntoFile(entry.fullPath);
            }
        });

        if (refFile) {
            if (!p.childDir_requireRefFile) {
                throw declareError("A .ref file is NOT expected", itemPath);
            }
        } else {
            if (p.childDir_requireRefFile) {
                throw declareError("A .ref file is required", itemPath);
            }
        }

        // File named "defaultPriority", "highPriority", ...
        // allow giving a priority to the rule.
        //
        const priority: PriorityLevel|undefined = await searchPriorityLevel(itemPath);

        if (itemUid) {
            if (p.childDir_errorIfMyUidFile) {
                throw declareError("A .myuid file is found here but NOT EXPECTED", itemPath);
            }
        }
        else {
            if (p.childDir_requireMyUidFile) {
                throw declareError("A .myuid file is required", itemPath);
            }
        }

        await p.itemProcessor({
            itemName, itemUid, itemAlias, refFile,
            itemPath, isFile, resolved, priority,
            itemCategory: p.itemCategory
        });
    }

    let dirContent = await getSortedDirItem(p.dirToScan);

    for (let entry of dirContent) {
        if (!await checkDirItem(entry, false)) continue

        if (p.dirToScan_expectFsType === "file") {
            if (entry.isFile) {
                await processDirItem(entry.fullPath, entry.name, true);
            }
        } else if (p.dirToScan_expectFsType === "dir") {
            if (entry.isDirectory) {
                await processDirItem(entry.fullPath, entry.name, false);
            }
        } else if (p.dirToScan_expectFsType === "fileOrDir") {
            await processDirItem(entry.fullPath, entry.name, entry.isFile===true);
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
            dirToScan: itemType.fullPath,
            dirToScan_expectFsType: "dir",
            dirToScan_nameConstraint: "mustNotBeUid",

            itemCategory: itemType.name,

            childDir_requireMyUidFile: true,

            childDir_filesToResolve: {
                "info": ["info.json"],
                "entryPoint": ["index.tsx", "index.ts"]
            },

            itemProcessor: async (props) => {
                if (!props.resolved?.entryPoint) {
                    throw declareError("No 'index.ts' or 'index.tsx' file found", props.itemPath);

                }

                addDefine(
                    props.itemUid!, props.itemAlias,
                    props.resolved.entryPoint, props.itemCategory, props.itemPath);
            }
        });
    }
}

async function processReplacesDir(moduleDir: string) {
    let itemTypes = await jk_fs.listDir(jk_fs.join(moduleDir, "@replaces"));

    for (let itemType of itemTypes) {
        if ((itemType.name[0]==='_') || (itemType.name[0]==='.')) continue;

        await processDir({
            dirToScan: itemType.fullPath,
            dirToScan_expectFsType: "dir",
            dirToScan_nameConstraint: "canBeUid",

            childDir_errorIfMyUidFile: false,
            childDir_requireMyUidFile: false,
            childDir_createMissingMyUidFile: false,

            childDir_requireRefFile: true,

            itemCategory: itemType.name,

            itemProcessor: async (props) => {
                const itemToReplace = props.itemName;
                const mustReplaceWith = props.refFile!;
                addReplace(itemToReplace, mustReplaceWith, props.priority, props.itemPath);
            }
        });
    }
}

/**
 * This function checks the validity of a directory item
 * and allows to know if we must skip this item.
 */
async function checkDirItem(entry: jk_fs.DirItem, allowUidRefFile: boolean) {
    if (entry.isSymbolicLink) return false;

    if (!allowUidRefFile && entry.name.endsWith(".ref")) {
        throw declareError("A .ref file is found here but not expected", entry.fullPath);
    }

    // _ allows generating an UID replacing the item.
    //
    if ((entry.name === "_.ref") || (entry.name === "_.myuid")) {
        let uid = jk_tools.generateUUIDv4();
        let newPath = jk_fs.join(jk_fs.dirname(entry.fullPath), uid + jk_fs.extname(entry.name));
        await jk_fs.rename(entry.fullPath, newPath);
        entry.fullPath = newPath;
        entry.name = uid;
    }

    // Skip if start with a "."
    // Also, underscore allows disabling the item.
    //
    return !((entry.name[0] === "_") || (entry.name[0] === "."));
}

//endregion

await processProject();