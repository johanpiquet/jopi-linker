import * as jk_fs from "jopi-toolkit/jk_fs";
import {addArobaseType, addDefine, type ArobaseDirHandlerParams, declareError, scanDir} from "./engine.ts";

addArobaseType("defines", {
    dirScanner: processDefinesDir,
    async itemProcessor(e) {}
});

async function processDefinesDir(p: ArobaseDirHandlerParams) {
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

                addDefine({
                    uid: props.uid!,
                    alias: props.alias,
                    entryPoint: props.resolved.entryPoint,
                    itemType: props.itemType,
                    itemPath: props.itemPath,
                });
            }
        });
    }
}