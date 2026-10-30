-- Dos tipos de aviso nuevos: una orden de trabajo se creó o se cerró.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN ('OverdueDetected', 'ThresholdBreached', 'OverAllocationDetected', 'WorkOrderCreated', 'WorkOrderClosed'));
