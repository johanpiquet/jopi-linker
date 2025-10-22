import * as jk_fs from "jopi-toolkit/jk_fs";
import defineArobaseType, {type DefineItem} from "./typeDefines.ts";

import {
    addArobaseType, addToRegistry,
    checkDirItem, type ChildDirProcessorParams,
    declareError, genWriteFile, getRegistryItem,
    getSortedDirItem,
    type ItemProcessorParams, PriorityLevel, type RegistryItem, requireRegistryItem, scanChildDir,
    scanDir
} from "./engine.ts";

export interface Composite extends RegistryItem {
    uid: string;
    allDirPath: string[];
    items: CompositeItem[];
    itemsType: string;
}

export interface CompositeItem  {
    ref?: string;
    entryPoint?: string;
    priority: PriorityLevel;
    sortKey: string;
}

const arobaseType = addArobaseType("composites", {
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

    async itemProcessor(key, rItem, infos) {
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

        const composite = rItem as Composite;
        composite.items = sortByPriority(composite.items);

        let source = "";
        let count = 1;

        let outDir = jk_fs.join(infos.genDir, "id");

        for (let item of composite.items) {
            let entryPoint = item.entryPoint;

            if (!entryPoint) {
                let d = requireRegistryItem<DefineItem>(item.ref!, defineArobaseType);
                entryPoint = d.entryPoint;
            }

            entryPoint = jk_fs.getRelativePath(outDir, entryPoint);
            source += `import I${count++} from "${entryPoint}";\n`;
        }

        let max = composite.items.length;
        source += "\nexport const C = [";
        for (let i = 1; i <= max; i++) source += `I${i},`;
        source += "];";

        await genWriteFile(jk_fs.join(outDir, key + ".ts"), source);
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

function addComposite(uid: string, items: CompositeItem[], itemPath: string, itemsType: string) {
    let current = getRegistryItem<Composite>(uid, arobaseType);

    if (!current) {
        addToRegistry([uid], {uid, allDirPath: [itemPath], items, itemsType, arobaseType, itemPath});
        return;
    }

    if (current.itemsType !== itemsType) {
        throw declareError(`The composite ${uid} is already defined and has a different type: ${current.itemsType}`, itemPath);
    }

    current.allDirPath.push(itemPath);
    current.items.push(...items);
}

export default arobaseType;