import { z } from 'zod';
export declare const nocSchema: z.ZodString;
export declare const bibNumberSchema: z.ZodString;
export declare const gunNumberSchema: z.ZodString;
export declare const contactNumberSchema: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
export declare const loginSchema: z.ZodObject<{
    username: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
export declare const changePasswordSchema: z.ZodObject<{
    currentPassword: z.ZodString;
    newPassword: z.ZodString;
}, z.core.$strip>;
export declare const createUserSchema: z.ZodObject<{
    full_name: z.ZodString;
    username: z.ZodString;
    password: z.ZodString;
    role: z.ZodEnum<{
        admin: "admin";
        staff: "staff";
    }>;
    permissions: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        "barcodes.print": "barcodes.print";
        "import.use": "import.use";
        "participants.create": "participants.create";
        "participants.delete": "participants.delete";
        "participants.edit": "participants.edit";
        "participants.view": "participants.view";
        "reports.export": "reports.export";
        "reports.view": "reports.view";
        "scan.use": "scan.use";
        "settings.manage": "settings.manage";
        "transactions.correct": "transactions.correct";
        "transactions.view": "transactions.view";
        "users.manage": "users.manage";
    }>>>;
    active: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const updateUserSchema: z.ZodObject<{
    full_name: z.ZodOptional<z.ZodString>;
    username: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodEnum<{
        admin: "admin";
        staff: "staff";
    }>>;
    permissions: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        "barcodes.print": "barcodes.print";
        "import.use": "import.use";
        "participants.create": "participants.create";
        "participants.delete": "participants.delete";
        "participants.edit": "participants.edit";
        "participants.view": "participants.view";
        "reports.export": "reports.export";
        "reports.view": "reports.view";
        "scan.use": "scan.use";
        "settings.manage": "settings.manage";
        "transactions.correct": "transactions.correct";
        "transactions.view": "transactions.view";
        "users.manage": "users.manage";
    }>>>;
    active: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const resetPasswordSchema: z.ZodObject<{
    newPassword: z.ZodString;
}, z.core.$strip>;
export declare const categorySchema: z.ZodObject<{
    name: z.ZodString;
    active: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const participantSchema: z.ZodObject<{
    bib_number: z.ZodString;
    noc: z.ZodString;
    name: z.ZodString;
    department: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    gun_number: z.ZodString;
    contact_number: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    category_id: z.ZodNumber;
}, z.core.$strip>;
export declare const participantUpdateSchema: z.ZodObject<{
    bib_number: z.ZodOptional<z.ZodString>;
    noc: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    department: z.ZodOptional<z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>>;
    gun_number: z.ZodOptional<z.ZodString>;
    contact_number: z.ZodOptional<z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>>;
    category_id: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const importCommitSchema: z.ZodObject<{
    previewId: z.ZodString;
    mode: z.ZodEnum<{
        skip: "skip";
        update: "update";
    }>;
}, z.core.$strip>;
export declare const scanSchema: z.ZodObject<{
    code: z.ZodString;
    manual: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    confirm: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
export declare const settingsUpdateSchema: z.ZodRecord<z.ZodString, z.ZodString>;
export declare const participantQuerySchema: z.ZodObject<{
    search: z.ZodOptional<z.ZodString>;
    noc: z.ZodOptional<z.ZodString>;
    department: z.ZodOptional<z.ZodString>;
    category_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    pouch_status: z.ZodOptional<z.ZodEnum<{
        in: "in";
        out: "out";
    }>>;
    page: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sort: z.ZodOptional<z.ZodString>;
    order: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>;
export declare const transactionQuerySchema: z.ZodObject<{
    search: z.ZodOptional<z.ZodString>;
    participant_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    gun_number: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodEnum<{
        in: "in";
        out: "out";
    }>>;
    user_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const printSelectionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"ids">;
    ids: z.ZodArray<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"filter">;
    filter: z.ZodObject<{
        noc: z.ZodOptional<z.ZodString>;
        department: z.ZodOptional<z.ZodString>;
        categoryId: z.ZodOptional<z.ZodNumber>;
        pouchStatus: z.ZodOptional<z.ZodEnum<{
            in: "in";
            out: "out";
        }>>;
        search: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"unprinted">;
}, z.core.$strip>], "type">;
export declare const printLabelsSchema: z.ZodObject<{
    selection: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"ids">;
        ids: z.ZodArray<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"filter">;
        filter: z.ZodObject<{
            noc: z.ZodOptional<z.ZodString>;
            department: z.ZodOptional<z.ZodString>;
            categoryId: z.ZodOptional<z.ZodNumber>;
            pouchStatus: z.ZodOptional<z.ZodEnum<{
                in: "in";
                out: "out";
            }>>;
            search: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"unprinted">;
    }, z.core.$strip>], "type">;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
