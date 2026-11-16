// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
export interface MysqlDatabase { id:string; name:string; charset:string; collation:string; }
export interface MysqlDatabaseObject { id:string; name:string; type:string; engine:string|null; rows:string|null; dataBytes:string|null; indexBytes:string|null; parent:string|null; }
export interface MysqlDatabaseSnapshot { databases:MysqlDatabase[]; scope:'visible'; fetchedAt:string; }
export interface MysqlDatabaseDetail { database:MysqlDatabase; objects:MysqlDatabaseObject[]; scope:'visible'; fetchedAt:string; }

export interface MysqlDatabaseDraft {action:'create'|'alter';name:string;charset:string;collation:string;}
export interface MysqlDatabaseOption {charset:string;collation:string;isDefault:boolean;}
