import * as path from 'path';
import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as efs from '@aws-cdk/aws-efs';
import * as lambda from '@aws-cdk/aws-lambda';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2';
import * as integrations from '@aws-cdk/aws-apigatewayv2-integrations';
import { FileSystemProps, InferenceProps } from './interfaces/interface';

class HttpApi extends cdk.Construct {
  public api: apigwv2.HttpApi;
  public stage: apigwv2.IStage;

  constructor(scope: cdk.Construct, id: string) {
    super(scope, id);

    this.api = new apigwv2.HttpApi(this, id, {
      apiName: `InferenceApi`,
      corsPreflight: {
        allowHeaders: ['Authorization'],
        allowMethods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST, apigwv2.HttpMethod.OPTIONS],
        allowOrigins: ['*'],
        maxAge: cdk.Duration.days(10),
      },
    });

    this.stage = new apigwv2.HttpStage(this, `${id}Stage`, {
      httpApi: this.api,
      stageName: 'dev',
      autoDeploy: true,
    });

    new cdk.CfnOutput(this, `${id}Url`, {
      exportName: 'HttpApiUrl',
      value: `${this.api.url}${this.stage.stageName}`,
    });
  }
}

class InferenceEngine extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: InferenceProps) {
    super(scope, id);

    const inferenceFunction = new lambda.Function(this, `${props.model}InferenceFunction`, {
      code: lambda.Code.fromAsset(path.resolve(__dirname, 'functions', 'inference')),
      handler: `${props.model}.handler`,
      runtime: lambda.Runtime.PYTHON_3_7,
      timeout: cdk.Duration.minutes(5),
      filesystem: lambda.FileSystem.fromEfsAccessPoint(props.accessPoint, `/mnt/inference`),
      functionName: `${props.model}InferenceFunction`,
      vpc: props.vpc,
      memorySize: 1024*10,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE,
      },
      environment: {
        PYTHONPATH: `/mnt/inference/${props.model}/lib`,
        TORCH_HOME: `/mnt/inference/${props.model}/model`,
        TF_WEIGHTS: `/mnt/inference/${props.model}/model/yolov4-416`,
      }
    });
    inferenceFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // AmazonElasticFileSystemClientFullAccess
        "elasticfilesystem:ClientMount",
        "elasticfilesystem:ClientRootAccess",
        "elasticfilesystem:ClientWrite",
        "elasticfilesystem:DescribeMountTargets",
        // AWSLambdaVPCAccessExecutionRole
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface",
        "ec2:AssignPrivateIpAddresses",
        "ec2:UnassignPrivateIpAddresses"
      ],
      resources: ['*'],
    }));
    const inferenceIntegration = new integrations.LambdaProxyIntegration({
      handler: inferenceFunction,
    });

    props.api.addRoutes({
      path: `/inference/${props.model}`,
      methods: [apigwv2.HttpMethod.POST],
      integration: inferenceIntegration,
    });
  }
}

class InferenceFileSystem extends cdk.Construct {
  public accessPoint: efs.AccessPoint;

  constructor(scope: cdk.Construct, id: string, props: FileSystemProps) {
    super(scope, id);

    const fileSystem = new efs.FileSystem(this, 'inferenceFs', {
      vpc: props.vpc,
      securityGroup: props.securityGroup,
      fileSystemName: 'inference',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.accessPoint = new efs.AccessPoint(this, 'InferenceFsAccessPoint', {
      fileSystem,
      path: '/',
      posixUser: {
        uid: '1001',
        gid: '1001',
      },
      createAcl: {
        ownerUid: '1001',
        ownerGid: '1001',
        permissions: '0777'
      },
    });

    new cdk.CfnOutput(this, `FilesystemId`, {
      exportName: 'FilesystemId',
      value: `${fileSystem.fileSystemId}`,
    });
    new cdk.CfnOutput(this, `AccessPointId`, {
      exportName: 'AccessPointId',
      value: `${this.accessPoint.accessPointId}`,
    });
  }
}

class BastionHost extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: FileSystemProps) {
    super(scope, id);

    const bastionHostLinux = new ec2.BastionHostLinux(this, `BastionHostLinux`, {
      vpc: props.vpc,
      securityGroup: props.securityGroup,
      subnetSelection: {
        subnetType: ec2.SubnetType.PRIVATE,
      },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.XLARGE),
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(64)
        }
      ],
    });
    bastionHostLinux.role.addManagedPolicy({
      managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonElasticFileSystemClientFullAccess',
    });
    bastionHostLinux.role.addManagedPolicy({
      managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonElasticFileSystemsUtils',
    });

    new cdk.CfnOutput(this, `BastionhostId`, {
      exportName: 'BastionHostId',
      value: `${bastionHostLinux.instanceId}`,
    });
  }
}

export class InfraStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, `Vpc`, { maxAzs: 2 });
    const securityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'DefaultSecurityGroup', vpc.vpcDefaultSecurityGroup);

    const fileSystem = new InferenceFileSystem(this, 'InferenceFileSystem', {
      vpc,
      securityGroup,
    });

    const httpApi = new HttpApi(this, 'HttpApi');
    new InferenceEngine(this, 'DetrInferenceEngine', {
      vpc,
      accessPoint: fileSystem.accessPoint,
      api: httpApi.api,
      model: 'detr',
    });
    new InferenceEngine(this, 'YoloInferenceEngine', {
      vpc,
      accessPoint: fileSystem.accessPoint,
      api: httpApi.api,
      model: 'yolo',
    });

    new BastionHost(this, 'BastionHost', {
      vpc,
      securityGroup,
    });
  }
}
