import * as jk_fs from "jopi-toolkit/jk_fs";
import {
    addArobaseType,
    addToRegistry,
    createLink_Symlink,
    declareError,
    type RegistryItem,
    scanDir
} from "./engine.ts";

export interface DefineType extends RegistryItem {
    entryPoint: string;
    itemType: string;
}

const arobaseType = addArobaseType("defines", {
    async dirScanner(p) {
        let allChildDir = await jk_fs.listDir(p.arobaseDir);

        for (let childDir of allChildDir) {
            if ((childDir.name[0]==='_') || (childDir.name[0]==='.')) continue;

            await scanDir({
                dirToScan: childDir.fullPath,
                dirToScan_expectFsType: "dir",
                childDir_nameConstraint: "mustNotBeUid",

                itemType: childDir.name,

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

                    const newItem: DefineType = {
                        arobaseType: arobaseType,
                        entryPoint: props.resolved.entryPoint,
                        itemType: props.itemType,
                        itemPath: props.itemPath,
                    };

                    addToRegistry([props.uid!, ...props.alias], newItem);
                }
            });
        }
    },

    async itemProcessor(key, rItem, infos) {
        const item = rItem as DefineType;
        const newFilePath = jk_fs.join(infos.genDir, "id", key);
        await createLink_Symlink(newFilePath, jk_fs.dirname(item.entryPoint));
    }
});

export default arobaseType;