import * as jk_fs from "jopi-toolkit/jk_fs";

import {
    addArobaseType,
    addComposite,
    type ArobaseDirHandlerParams, checkDirItem, type ChildDirProcessorParams,
    type CompositeItem, declareError,
    getSortedDirItem,
    type ItemProcessorParams, scanChildDir,
    scanDir
} from "./engine.ts";

addArobaseType("composites", {
    dirScanner: processCompositesDir,
    async itemProcessor(e) {
    }
});

async function processCompositesDir(p: ArobaseDirHandlerParams) {
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
}

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
