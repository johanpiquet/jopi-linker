import * as jk_fs from "jopi-toolkit/jk_fs";
import {
    addArobaseType,
    addToRegistry,
    createLink_Symlink,
    declareError,
    type RegistryItem,
    scanDir
} from "./engine.ts";

export interface DefineItem extends RegistryItem {
    uid: string;
    alias: string[];
    entryPoint: string;
    itemType: string;
}

const arobaseType = addArobaseType("defines", {
    async dirScanner(p) {
        let itemTypes = await jk_fs.listDir(p.arobaseDir);

        for (let itemType of itemTypes) {
            if ((itemType.name[0]==='_') || (itemType.name[0]==='.')) continue;

            await scanDir({
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

                    addToRegistry([props.uid!, ...props.alias], {
                        arobaseType: arobaseType,

                        uid: props.uid!,
                        alias: props.alias,
                        entryPoint: props.resolved.entryPoint,
                        itemType: props.itemType,
                        itemPath: props.itemPath,
                    });
                }
            });
        }
    },

    async itemProcessor(key, rItem, infos) {
        const item = rItem as DefineItem;
        const newFilePath = jk_fs.join(infos.genDir, "id", key);
        await createLink_Symlink(newFilePath, jk_fs.dirname(item.entryPoint));
    }
});

export default arobaseType;