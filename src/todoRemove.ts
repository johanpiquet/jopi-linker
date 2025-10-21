import {addCustomTypeHandler} from "./index.ts";

addCustomTypeHandler("ui.composite", async (params) => {
    console.log("test", params);
});