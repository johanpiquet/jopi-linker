import * as jk_fs from "jopi-toolkit/jk_fs";
import {addArobaseType, scanDir, addReplace} from "./engine.ts";

addArobaseType("replaces", {
    async dirScanner(p) {
        let itemTypes = await jk_fs.listDir(p.arobaseDir);

        for (let itemType of itemTypes) {
            if ((itemType.name[0]==='_') || (itemType.name[0]==='.')) continue;

            await scanDir({
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
    },

    async itemProcessor(e) {}
});