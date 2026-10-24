import type { LabelConfig } from '../../../shared/label.js';
export declare const printingRouter: import("express-serve-static-core").Router;
export declare function getLabelConfigFromDb(db: any): {
    labelConfig: LabelConfig;
    printerName: string;
    driverOverride?: 'windows' | 'file';
};
