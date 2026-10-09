// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as AlertsAPI from './alerts';
import { Alerts, SafetyAlert } from './alerts';
import * as CasesAPI from './cases';
import { Cases, SafetyCase } from './cases';

export class Safety extends APIResource {
  cases: CasesAPI.Cases = new CasesAPI.Cases(this._client);
  alerts: AlertsAPI.Alerts = new AlertsAPI.Alerts(this._client);
}

Safety.Cases = Cases;
Safety.Alerts = Alerts;

export declare namespace Safety {
  export { Cases as Cases, type SafetyCase as SafetyCase };

  export { Alerts as Alerts, type SafetyAlert as SafetyAlert };
}
