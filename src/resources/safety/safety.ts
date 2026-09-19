// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as AlertsAPI from './alerts';
import { Alerts, SafetyAlert } from './alerts';
import * as CasesAPI from './cases';
import { Cases, SafetyCase } from './cases';

export class Safety extends APIResource {
  alerts: AlertsAPI.Alerts = new AlertsAPI.Alerts(this._client);
  cases: CasesAPI.Cases = new CasesAPI.Cases(this._client);
}

Safety.Alerts = Alerts;
Safety.Cases = Cases;

export declare namespace Safety {
  export { Alerts as Alerts, type SafetyAlert as SafetyAlert };

  export { Cases as Cases, type SafetyCase as SafetyCase };
}
