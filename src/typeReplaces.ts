import * as jk_fs from "jopi-toolkit/jk_fs";
import {addArobaseType, processThisDirItems, addReplace} from "./engine.ts";

addArobaseType("replaces", {
    async processDir(p) {
        let itemTypes = await jk_fs.listDir(p.arobaseDir);

        for (let itemType of itemTypes) {
            if ((itemType.name[0]==='_') || (itemType.name[0]==='.')) continue;

            await processThisDirItems({
                dirToScan: itemType.fullPath,
                dirToScan_expectFsType: "dir",
                childDir_nameConstraint: "canBeUid",

                childDir_requireMyUidFile: false,
                childDir_requireRefFile: true,

                rootDirName: itemType.name,

                transform: async (props) => {
                    const itemToReplace = props.itemName;
                    const mustReplaceWith = props.refFile!;
                    addReplace(itemToReplace, mustReplaceWith, props.priority, props.itemPath);
                }
            });
        }
    },

    async generateCodeForItem(e) {}
});