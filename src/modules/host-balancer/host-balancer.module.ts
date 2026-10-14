import { Module } from '@nestjs/common';

import { HostBalancerService } from './host-balancer.service';

@Module({
    providers: [HostBalancerService],
    exports: [HostBalancerService],
})
export class HostBalancerModule {}
