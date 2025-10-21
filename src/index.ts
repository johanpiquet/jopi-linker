import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_tools from "jopi-toolkit/jk_tools";
import * as jk_term from "jopi-toolkit/jk_term";
import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_what from "jopi-toolkit/jk_what";

const LOG = false;

//region Helpers

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

function declareError(message: string, filePath?: string): Error {
    jk_term.logBgRed("⚠️ Error -", message, "⚠️");
    if (filePath) jk_term.logBlue("See:", jk_fs.pathToFileURL(filePath));
    process.exit(1);
}

function addNameIntoFile(filePath: string) {
    jk_fs.writeTextToFile(filePath, jk_fs.basename(filePath)).catch();
}

async function getSortedDirItem(dirPath: string): Promise<jk_fs.DirItem[]> {
    const items = await jk_fs.listDir(dirPath);
    return items.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * This function checks the validity of a directory item
 * and allows to know if we must skip this item.
 */
async function checkDirItem(entry: jk_fs.DirItem, allowRefFile: boolean) {
    if (entry.isSymbolicLink) return false;

    if (!allowRefFile && entry.name.endsWith(".ref")) {
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

//region Registry

export interface DefineItem {
    uid: string;
    alias: string[];
    entryPoint: string;
    itemType: string;
    itemPath: string;
}

export interface ReplaceItem {
    mustReplace: string;
    mustReplaceIsUID: boolean;

    replaceWith: string;
    replaceWithIsUID: boolean;

    priority: PriorityLevel;
    declarationFile: string;
}

export interface CompositeItem {
    ref?: string;
    entryPoint?: string;
    priority: PriorityLevel;
    sortKey: string;
}

export interface Composite {
    uid: string;
    allDirPath: string[];
    items: CompositeItem[];
    itemsType: string;
}

const gDefine: Record<string, DefineItem> = {};
const gReplacing: Record<string, ReplaceItem> = {};
const gComposites: Record<string, Composite> = {};

export function requireDefine(uid: string): DefineItem {
    let entry = gDefine[uid];
    if (!entry) throw declareError("The UID " + uid + " is required but not defined");
    return entry;
}

export function addReplace(mustReplace: string, replaceWith: string, priority: PriorityLevel|undefined, declarationFile: string) {
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

export function addDefine(itemUid: string, itemAlias: string[], entryPoint: string, itemType: string, itemPath: string) {
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
        entryPoint, itemType: itemType, itemPath
    };

    gDefine[itemUid] = entry;
    for (let alias of itemAlias) gDefine[alias] = entry;

    const relPath = jk_fs.getRelativePath(gSrcRootDir, entryPoint);

    if (LOG) {
        console.log("Add DEFINE", itemUid, "=>", relPath);
        for (let alias of itemAlias) console.log("Add ALIAS", alias, "=>", itemUid);
    }
}

function addComposite(uid: string, items: CompositeItem[], dirPath: string, itemsType: string) {
    let current = gComposites[uid];

    if (!current) {
        gComposites[uid] = {uid, allDirPath: [dirPath], items, itemsType};
        return;
    }

    if (current.itemsType !== itemsType) {
        throw declareError(`The composite ${uid} is already defined with a different item type (${current.itemsType})`, dirPath);
    }

    current.allDirPath.push(dirPath);
    current.items.push(...items);
}

async function createLinks() {
    function applyReplaces() {
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
    }

    async function emitDefines() {
        async function doDefine(itemId: string, entry: DefineItem) {
            await createImportRef(entry.itemType, itemId, entry.entryPoint);
        }

        for (let key in gDefine) {
            const entry = gDefine[key];
            await doDefine(key, entry);
        }
    }

    async function emitComposites() {
        async function emitComposite(composite: Composite) {
            composite.items = sortByPriority(composite.items);

            let source = "";
            let count = 1;

            let outDir = jk_fs.join(gGenRootDir, "@composite", composite.itemsType);

            for (let item of composite.items) {
                let entryPoint = item.entryPoint;

                if (!entryPoint) {
                    let d = requireDefine(item.ref!);
                    entryPoint = d.entryPoint;
                }

                entryPoint = jk_fs.getRelativePath(outDir, entryPoint);
                source += `import I${count++} from "${entryPoint}";\n`;
            }

            let max = composite.items.length;
            source += "\nexport const C = [";
            for (let i=1;i<=max;i++) source += `I${i},`;
            source += "];";

            await genWriteFile(jk_fs.join(outDir, composite.uid + ".ts"), source);
        }

        function sortByPriority(items: CompositeItem[]): CompositeItem[] {
            function addPriority(priority: PriorityLevel) {
                let e = byPriority[priority];
                if (e) items.push(...e);
            }

            const byPriority: any = {};

            for (let item of items) {
                if (!byPriority[item.priority]) byPriority[item.priority] = [];
                byPriority[item.priority].push(item);
            }

            items = [];

            addPriority(PriorityLevel.veryHigh);
            addPriority(PriorityLevel.high);
            addPriority(PriorityLevel.default);
            addPriority(PriorityLevel.low);
            addPriority(PriorityLevel.veryLow);

            return items;
        }

        for (let composite of Object.values(gComposites)) {
            await emitComposite(composite);
        }
    }

    applyReplaces();
    await emitDefines();
    await emitComposites();
}

//endregion

//region Processing dir

export interface ChildDirProcessorParams {
    itemType: string;

    childDir_filesToResolve?: Record<string, string[]>;
    childDir_requireRefFile?: boolean;
    childDir_requireMyUidFile?: boolean;
    childDir_createMissingMyUidFile?: boolean;
    childDir_nameConstraint: "canBeUid"|"mustNotBeUid"|"mustBeUid";

    itemProcessor: (props: ItemProcessorParams) => Promise<void>;
}

export interface DirProcessorParams extends ChildDirProcessorParams {
    dirToScan: string;
    dirToScan_expectFsType: "file"|"dir"|"fileOrDir";
}

export interface ItemProcessorParams {
    itemName: string;
    itemUid?: string;
    itemAlias: string[];
    refFile?: string;

    itemPath: string;
    itemType: string;
    isFile: boolean;
    priority: PriorityLevel;

    resolved: Record<string, string|undefined>;
}

export enum PriorityLevel {
    veryLow = -200,
    low = -100,
    default = 0,
    high = 100,
    veryHigh = 200,
}

async function searchPriorityLevel(baseDir: string): Promise<PriorityLevel> {
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

    if (!priority) return PriorityLevel.default;
    return priority;
}

async function processDir(p: DirProcessorParams) {
    let dirContent = await jk_fs.listDir(p.dirToScan);

    for (let entry of dirContent) {
        if (!await checkDirItem(entry, false)) continue

        if (p.dirToScan_expectFsType === "file") {
            if (entry.isFile) {
                await processChildDir(p, entry);
            }
        } else if (p.dirToScan_expectFsType === "dir") {
            if (entry.isDirectory) {
                await processChildDir(p, entry);
            }
        } else if (p.dirToScan_expectFsType === "fileOrDir") {
            await processChildDir(p, entry);
        }
    }
}

async function processChildDir(p: ChildDirProcessorParams, dirItem: jk_fs.DirItem) {
    const itemPath = dirItem.fullPath;
    const itemName = dirItem.name;
    const isFile = dirItem.isFile;

    // The file / folder-name is a UUID4?
    let isUUID = jk_tools.isUUIDv4(itemName);

    if (isUUID) {
        if (p.childDir_nameConstraint==="mustNotBeUid") {
            throw declareError("The name must NOT be an UID", itemPath);
        }
    } else {
        if (p.childDir_nameConstraint==="mustBeUid") {
            throw declareError("The name MUST be an UID", itemPath);
        }
    }

    // It's a file?
    if (isFile) {
        if ((p.childDir_requireMyUidFile===true) && !isUUID) {
            throw declareError("The file name MUST be an UID", itemPath);
        }

        // Process it now.
        await p.itemProcessor({
            itemName,
            itemUid: isUUID ? itemName : undefined,
            itemAlias: [],

            priority: PriorityLevel.default,

            itemPath, isFile,
            itemType: p.itemType,

            resolved: {}
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
        if (p.childDir_requireRefFile===false) {
            throw declareError("A .ref file is NOT expected", itemPath);
        }
    } else {
        if (p.childDir_requireRefFile===true) {
            throw declareError("A .ref file is required", itemPath);
        }
    }

    // File named "defaultPriority", "highPriority", ...
    // allow giving a priority to the rule.
    //
    const priority: PriorityLevel = await searchPriorityLevel(itemPath);

    if (itemUid) {
        if (p.childDir_requireMyUidFile===false) {
            throw declareError("A .myuid file is found here but NOT EXPECTED", itemPath);
        }
    }
    else {
        if (p.childDir_requireMyUidFile===true) {
            throw declareError("A .myuid file is required", itemPath);
        }
    }

    await p.itemProcessor({
        itemName, itemUid, itemAlias, refFile,
        itemPath, isFile, resolved, priority,
        itemType: p.itemType
    });
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
    await processCompositesDir(moduleDir);
    await processReplacesDir(moduleDir);
}

async function processDefinesDir(moduleDir: string) {
    let itemTypes = await jk_fs.listDir(jk_fs.join(moduleDir, "@defines"));

    for (let itemType of itemTypes) {
        if ((itemType.name[0]==='_') || (itemType.name[0]==='.')) continue;

        let handler = gCustomTypeHandlers[itemType.name];

        if (handler) {
            await handler({moduleDir, dirToScan: itemType.fullPath});
            continue;
        }

        await processDir({
            dirToScan: itemType.fullPath,
            dirToScan_expectFsType: "dir",
            childDir_nameConstraint: "mustNotBeUid",

            itemType: itemType.name,

            childDir_requireMyUidFile: true,
            childDir_requireRefFile: false,

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
                    props.resolved.entryPoint, props.itemType, props.itemPath);
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
            childDir_nameConstraint: "canBeUid",

            childDir_requireMyUidFile: false,
            childDir_requireRefFile: true,

            itemType: itemType.name,

            itemProcessor: async (props) => {
                const itemToReplace = props.itemName;
                const mustReplaceWith = props.refFile!;
                addReplace(itemToReplace, mustReplaceWith, props.priority, props.itemPath);
            }
        });
    }
}

async function processCompositesDir(moduleDir: string) {
    let itemTypes = await jk_fs.listDir(jk_fs.join(moduleDir, "@composites"));

    for (let itemType of itemTypes) {
        if ((itemType.name[0]==='_') || (itemType.name[0]==='.')) continue;

        await processDir({
            dirToScan: itemType.fullPath,
            dirToScan_expectFsType: "dir",
            childDir_nameConstraint: "mustNotBeUid",

            childDir_requireMyUidFile: true,
            childDir_createMissingMyUidFile: true,
            childDir_requireRefFile: false,

            itemType: itemType.name,

            itemProcessor: processComposite
        });
    }
}

async function processComposite(p: ItemProcessorParams) {
    let compositeId = p.itemUid!;
    const dirItems = await getSortedDirItem(p.itemPath);

    let compositeItems: CompositeItem[] = [];

    const params: ChildDirProcessorParams = {
        itemType: p.itemType,
        childDir_nameConstraint: "mustNotBeUid",
        childDir_requireMyUidFile: false,

        childDir_filesToResolve: {
            "entryPoint": ["index.tsx", "index.ts"]
        },

        itemProcessor: async (item) => {
            if (item.refFile && item.resolved.entryPoint) {
                throw declareError("The composite can't have an index file and a .ref file", item.itemPath);
            }

            compositeItems.push({
                priority: item.priority,
                sortKey: item.itemName,
                ref: item.refFile,
                entryPoint: item.resolved.entryPoint
            });
        }
    };

    for (let dirItem of dirItems) {
        if (!dirItem.isDirectory) continue;
        if (!await checkDirItem(dirItem, false)) continue;
        await processChildDir(params, dirItem);
    }

    addComposite(compositeId, compositeItems, p.itemPath, p.itemType);
}

//endregion

//region Hacking

export type CustomTypeHandler = (p: {
                                        moduleDir: string,
                                        dirToScan: string
                                 }) => Promise<void>;

let gCustomTypeHandlers: Record<string, CustomTypeHandler> = {};

/**
 * Allows hacking how the `@defines/customType` items are processed.
 */
export function addCustomTypeHandler(customType: string, handler: CustomTypeHandler) {
    gCustomTypeHandlers[customType] = handler;
}

//endregion

//region Bootstrap

let gProjectRootDir: string;
let gGenRootDir: string;
let gSrcRootDir: string;

async function bootstrap() {
    async function searchLinkerScript(): Promise<string|undefined> {
        let jopiLinkerScript = jk_fs.join(gProjectRootDir, "dist", "jopi-linker.js");
        if (await jk_fs.isFile(jopiLinkerScript)) return jopiLinkerScript;

        if (jk_what.isBunJS) {
            jopiLinkerScript = jk_fs.join(gSrcRootDir, "jopi-linker.ts");
            if (await jk_fs.isFile(jopiLinkerScript)) return jopiLinkerScript;
        }

        return undefined;
    }

    gProjectRootDir = jk_app.findPackageJsonDir();

    //TODO: remove
    gProjectRootDir = jk_fs.resolve(gProjectRootDir, "sampleProject");

    gSrcRootDir = jk_fs.join(gProjectRootDir, "src");
    gGenRootDir = jk_fs.join(gSrcRootDir, "_gen");

    let jopiLinkerScript = await searchLinkerScript();
    if (jopiLinkerScript) await import(jopiLinkerScript);

    //TODO: remove
    await import("./todoRemove.js")

    await processProject();
}

bootstrap().then();

//endregion