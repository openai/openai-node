// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../resource';
import * as CheckpointsAPI from './checkpoints/checkpoints';
import { Checkpoints } from './checkpoints/checkpoints';
import * as JobsAPI from './jobs/jobs';
import {
  FineTuningJob,
  FineTuningJobEvent,
  FineTuningJobEventsPage,
  FineTuningJobIntegration,
  FineTuningJobWandbIntegration,
  FineTuningJobWandbIntegrationObject,
  FineTuningJobsPage,
  JobCreateParams,
  JobListEventsParams,
  JobListParams,
  Jobs,
} from './jobs/jobs';

export class FineTuning extends APIResource {
  jobs: JobsAPI.Jobs = new JobsAPI.Jobs(this._client);
  checkpoints: CheckpointsAPI.Checkpoints = new CheckpointsAPI.Checkpoints(this._client);
}

FineTuning.Jobs = Jobs;
FineTuning.FineTuningJobsPage = FineTuningJobsPage;
FineTuning.FineTuningJobEventsPage = FineTuningJobEventsPage;
FineTuning.Checkpoints = Checkpoints;

export declare namespace FineTuning {
  export {
    Jobs as Jobs,
    type FineTuningJob as FineTuningJob,
    type FineTuningJobEvent as FineTuningJobEvent,
    type FineTuningJobIntegration as FineTuningJobIntegration,
    type FineTuningJobWandbIntegration as FineTuningJobWandbIntegration,
    type FineTuningJobWandbIntegrationObject as FineTuningJobWandbIntegrationObject,
    FineTuningJobsPage as FineTuningJobsPage,
    FineTuningJobEventsPage as FineTuningJobEventsPage,
    type JobCreateParams as JobCreateParams,
    type JobListParams as JobListParams,
    type JobListEventsParams as JobListEventsParams,
  };

  export { Checkpoints as Checkpoints };
}
