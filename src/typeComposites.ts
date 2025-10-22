import * as jk_fs from "jopi-toolkit/jk_fs";

import {
    addArobaseType,
    checkDirItem, type ChildDirProcessorParams,
    declareError,
    getSortedDirItem,
    type ItemProcessorParams, PriorityLevel, scanChildDir,
    scanDir
} from "./engine.ts";

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

const gComposites: Record<string, Composite> = {};

addArobaseType("composites", {
    async dirScanner(p) {
        let itemTypes = await jk_fs.listDir(p.arobaseDir);

        for (let itemType of itemTypes) {
            if ((itemType.name[0]==='_') || (itemType.name[0]==='.')) continue;

            await scanDir({
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
    },

    async itemProcessor(e) {
    }
});

async function processComposite(p: ItemProcessorParams) {
    let compositeId = p.uid!;
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
        await scanChildDir(params, dirItem);
    }

    addComposite(compositeId, compositeItems, p.itemPath, p.itemType);
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

/*async function generateComposites() {
    async function emitComposite(composite: Composite) {
        composite.items = sortByPriority(composite.items);

        let source = "";
        let count = 1;

        let outDir = jk_fs.join(gGenRootDir, "id");

        for (let item of composite.items) {
            let entryPoint = item.entryPoint;

            if (!entryPoint) {
                let d = requireRegistryItem(item.ref!);
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
}*/