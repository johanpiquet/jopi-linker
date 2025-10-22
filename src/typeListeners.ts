import * as jk_fs from "jopi-toolkit/jk_fs";
import defineArobaseType, {type DefineType} from "./typeDefines.ts";

import {
    addArobaseType, addToRegistry,
    checkDirItem, type ChildDirResolveAndTransformParams,
    declareError, genWriteFile, getRegistryItem,
    getSortedDirItem,
    type DirTransformParams, PriorityLevel, type RegistryItem, requireRegistryItem, resolveAndTransformChildDir,
    processThisDirItems, getProjectGenDir, genAddToInstaller_body, genAddToInstaller_imports
} from "./engine.ts";

export interface ListenerType extends RegistryItem {
    allDirPath: string[];
    listeners: ListenerPart[];
    eventName: string;
}

export interface ListenerPart {
    ref?: string;
    entryPoint?: string;
    priority: PriorityLevel;
    sortKey: string;
}

let gEvents: string[] = [];

const arobaseType = addArobaseType("listeners", {
    async processDir(p) {
        let allEventDir = await jk_fs.listDir(p.arobaseDir);

        for (let eventDir of allEventDir) {
            if ((eventDir.name[0]==='_') || (eventDir.name[0]==='.')) continue;

            await resolveAndTransformChildDir({
                childDir_nameConstraint: "mustNotBeUid",

                childDir_requireMyUidFile: false,
                childDir_createMissingMyUidFile: false,
                childDir_requireRefFile: false,

                rootDirName: eventDir.name,

                transform: transformEventListener
            }, eventDir);
        }
    },

    async generateCodeForItem(key, rItem, infos) {
        function sortByPriority(items: ListenerPart[]): ListenerPart[] {
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

        const event = rItem as ListenerType;
        event.listeners = sortByPriority(event.listeners);

        let source = "";
        let count = 1;
        let outDir = jk_fs.join(infos.genDir, "events");

        for (let item of event.listeners) {
            let entryPoint = item.entryPoint;

            if (!entryPoint) {
                let d = requireRegistryItem<DefineType>(item.ref!, defineArobaseType);
                entryPoint = d.entryPoint;
            }

            entryPoint = jk_fs.getRelativePath(outDir, entryPoint);
            source += `import E${count++} from "${entryPoint}";\n`;
        }

        source += "\nexport default async function(e: any) {";

        let max = event.listeners.length;

        for (let i = 1; i <= max; i++) {
            source += `\n   let r${i}: any = E${i}(e);`;
            source += `\n   if (r${i} instanceof Promise) await r${i};`;
            source += `\n   if (e.canceled || e.isCatch) return;`
        }

        source += "\n}";

        let fileName = key.substring(key.indexOf("_") + 1) + ".ts";
        await genWriteFile(jk_fs.join(outDir, fileName), source);

        gEvents.push(event.eventName);
    },

    async endGeneratingCode() {
        genAddToInstaller_imports(`import {addListener} from "jopi-toolkit/jk_events";\n`);
        let count = 0;
        for (let eventName of gEvents) {
            count++;

            genAddToInstaller_body(`
    let E${count}: undefined | ((event: any) => Promise<void>);
    addListener("myEvent", async (e) => {
        if (!E${count}) E${count} = (await import("@/events/${eventName}")).default;       
        await E${count}(e);
    });`                        ); // genAddToInstaller_body
        }
    }
});

function calcEventDir(eventName: string) {
    return jk_fs.join(getProjectGenDir(), "events", eventName);
}

async function transformEventListener(p: DirTransformParams) {
    let eventName = p.parentDirName;

    // > Extract the listener items.

    const dirItems = await getSortedDirItem(p.itemPath);
    let listenerItems: ListenerPart[] = [];

    const params: ChildDirResolveAndTransformParams = {
        rootDirName: eventName,
        childDir_nameConstraint: "mustNotBeUid",
        childDir_requireMyUidFile: false,

        childDir_filesToResolve: {
            "entryPoint": ["index.tsx", "index.ts"]
        },

        transform: async (item) => {
            if (item.refFile && item.resolved.entryPoint) {
                throw declareError("The event listener can't have both an index file and a .ref file", item.itemPath);
            }

            listenerItems.push({
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

    // > Add the listener.

    const registryKey = "event_" + eventName;
    let current = getRegistryItem<ListenerType>(registryKey, arobaseType);

    if (!current) {
        const newItem: ListenerType = {
            arobaseType, itemPath: p.itemPath,
            listeners: listenerItems, eventName: p.parentDirName, allDirPath: [p.itemPath]
        };

        addToRegistry([registryKey], newItem);
        return;
    }

    current.allDirPath.push(p.itemPath);
    current.listeners.push(...listenerItems);
}

export default arobaseType;