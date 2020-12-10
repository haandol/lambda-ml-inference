import * as ec2 from '@aws-cdk/aws-ec2';
import * as efs from '@aws-cdk/aws-efs';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2';

export interface InferenceProps {
  vpc: ec2.IVpc;
  accessPoint: efs.IAccessPoint;
  api: apigwv2.HttpApi;
  model: string;
}

export interface FileSystemProps {
  vpc: ec2.IVpc;
  securityGroup: ec2.ISecurityGroup;
}