// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as AuditLogsAPI from './audit-logs';
import { AuditLogListParams, AuditLogListResponse, AuditLogListResponsesPage, AuditLogs } from './audit-logs';

export class Organization extends APIResource {
  auditLogs: AuditLogsAPI.AuditLogs = new AuditLogsAPI.AuditLogs(this._client);
}

Organization.AuditLogs = AuditLogs;

export declare namespace Organization {
  export {
    AuditLogs as AuditLogs,
    type AuditLogListResponse as AuditLogListResponse,
    type AuditLogListResponsesPage as AuditLogListResponsesPage,
    type AuditLogListParams as AuditLogListParams,
  };
}
