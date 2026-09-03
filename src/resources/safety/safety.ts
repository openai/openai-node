// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as AlertsAPI from './alerts';
import { Alerts, SafetyAlert } from './alerts';

export class Safety extends APIResource {
  alerts: AlertsAPI.Alerts = new AlertsAPI.Alerts(this._client);
}

Safety.Alerts = Alerts;

export declare namespace Safety {
  export { Alerts as Alerts, type SafetyAlert as SafetyAlert };
}
