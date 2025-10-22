import * as jk_fs from "jopi-toolkit/jk_fs";
import defineArobaseType, {type DefineType} from "./typeDefines.ts";

import {
    addArobaseType, addToRegistry,
    checkDirItem, type ChildDirResolveAndTransformParams,
    declareError, genWriteFile, getRegistryItem,
    getSortedDirItem,
    type DirTransformParams, PriorityLevel, type RegistryItem, requireRegistryItem, resolveAndTransformChildDir,
    processThisDirItems
} from "./engine.ts";

export interface CompositeType extends RegistryItem {
    allDirPath: string[];
    items: CompositePart[];
    itemsType: string;
}

export interface CompositePart {
    ref?: string;
    entryPoint?: string;
    priority: PriorityLevel;
    sortKey: string;
}

const arobaseType = addArobaseType("composites", {
    async processDir(p) {
        let itemTypes = await jk_fs.listDir(p.arobaseDir);

        for (let itemType of itemTypes) {
            if ((itemType.name[0]==='_') || (itemType.name[0]==='.')) continue;

            await processThisDirItems({
                dirToScan: itemType.fullPath,
                dirToScan_expectFsType: "dir",
                childDir_nameConstraint: "mustNotBeUid",

                childDir_requireMyUidFile: true,
                childDir_createMissingMyUidFile: true,
                childDir_requireRefFile: false,

                rootDirName: itemType.name,

                transform: processComposite
            });
        }
    },

    async generateCodeForItem(key, rItem, infos) {
        function sortByPriority(items: CompositePart[]): CompositePart[] {
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

        const composite = rItem as CompositeType;
        composite.items = sortByPriority(composite.items);

        let source = "";
        let count = 1;

        let outDir = jk_fs.join(infos.genDir, "composites");

        for (let item of composite.items) {
            let entryPoint = item.entryPoint;

            if (!entryPoint) {
                let d = requireRegistryItem<DefineType>(item.ref!, defineArobaseType);
                entryPoint = d.entryPoint;
            }

            entryPoint = jk_fs.getRelativePath(outDir, entryPoint);
            source += `import I${count++} from "${entryPoint}";\n`;
        }

        let max = composite.items.length;
        source += "\nexport const C = [";
        for (let i = 1; i <= max; i++) source += `I${i},`;
        source += "];";

        let fileName = key.substring(key.indexOf("_") + 1) + ".ts";
        await genWriteFile(jk_fs.join(outDir, fileName), source);
    }
});

async function processComposite(p: DirTransformParams) {
    let compositeId = "composite_" + p.uid!;

    // > Extract the composite items.

    const dirItems = await getSortedDirItem(p.itemPath);
    let compositeItems: CompositePart[] = [];

    const params: ChildDirResolveAndTransformParams = {
        rootDirName: p.parentDirName,
        childDir_nameConstraint: "mustNotBeUid",
        childDir_requireMyUidFile: false,

        childDir_filesToResolve: {
            "entryPoint": ["index.tsx", "index.ts"]
        },

        transform: async (item) => {
            if (item.refFile && item.resolved.entryPoint) {
                throw declareError("The composite can't have both an index file and a .ref file", item.itemPath);
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
        await resolveAndTransformChildDir(params, dirItem);
    }

    // > Add the composite.

    let current = getRegistryItem<CompositeType>(compositeId, arobaseType);

    if (!current) {
        const newItem: CompositeType = {
            arobaseType, itemPath: p.itemPath,
            items: compositeItems, itemsType: p.parentDirName, allDirPath: [p.itemPath]
        };

        addToRegistry([compositeId], newItem);
        return;
    }

    if (current.itemsType !== p.parentDirName) {
        throw declareError(`The composite ${compositeId} is already defined and has a different type: ${current.itemsType}`, p.itemPath);
    }

    current.allDirPath.push(p.itemPath);
    current.items.push(...compositeItems);
}

export default arobaseType;