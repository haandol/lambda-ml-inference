# PyTorch Inference on Lambda + EFS

This repository is for inference using PyTorch on Lambda and EFS

Running this repository may cost you to provision AWS resources

<img src="img/architecture.png"/>

# Prerequisites

- awscli
- AWS Account and Locally configured AWS credential

# Installation

```bash
$ cd infra
$ npm i
```

Install cdk in global context and run bootstrap if you did not initailize cdk yet.
```bash
$ npm i -g cdk@1.76.0
$ cdk bootstrap
$ cdk deploy "*" --require-approval never
```

Connect to Bastionhost

```bash
export BASTION_ID=$(aws cloudformation describe-stacks --stack-name MLInferenceInfraStack --query "Stacks[0].Outputs[?ExportName=='BastionHostId'].OutputValue" --output text)
$ echo $BASTION_ID
i-01afaf5d4aafa5a9f

$ aws ssm start-session --target $BASTION_ID
sh-4.2$
```

Get EFS Filesystem Id and EFS AccessPoint Id

```bash
# Filesystem Id
$ aws cloudformation describe-stacks --stack-name MLInferenceInfraStack --query "Stacks[0].Outputs[?ExportName=='FilesystemId'].OutputValue" --output text
fsap-00770e5ffaf2cd41c

# EFS AccessPoint Id
$ aws cloudformation describe-stacks --stack-name MLInferenceInfraStack --query "Stacks[0].Outputs[?ExportName=='AccessPointId'].OutputValue" --output text
fs-4610f726
```

Mount EFS access point to Bastionhost

```bash
sh-4.2$ sudo yum -y install amazon-efs-utils
sh-4.2$ sudo mkdir /mnt/ml
sh-4.2$ sudo mount -t efs -o tls,iam,accesspoint=fsap-00770e5ffaf2cd41c fs-4610f726: /mnt/ml
sh-4.2$ sudo chown -R ssm-user:ssm-user /mnt/ml
```

Build *requirements.txt*

```bash
sh-4.2$ cd
sh-4.2$ cat >> requirements.txt
cython
submitit
torch>=1.5.0
torchvision>=0.6.0
scipy
^D
```

Install dependencies to run PyTorch on lambda

```bash
sh-4.2$ sudo yum install python3 -y
sh-4.2$ pip3 install -t /mnt/ml/lib -r requirements.txt
# Create directory for PyTorch hub cache
sh-4.2$ sudo -p mkdir /mnt/ml/model/hub
sh-4.2$ sudo chown -R 1001:1001 /mnt/ml
```

# Usage

Invoke `/inference` endpoint to classify bird in image

```bash
$ export URL=$(aws cloudformation describe-stacks --stack-name MLInferenceInfraStack --query "Stacks[0].Outputs[?ExportName=='HttpApiUrl'].OutputValue" --output text)
$ http post $URL/inference url==https://d2908q01vomqb2.cloudfront.net/da4b9237bacccdf19c0760cab7aec4a8359010b0/2020/05/26/western-grebe-300x227.jpg

HTTP/1.1 200 OK
Apigw-Requestid: XRdzDialIE0EQaw=
Connection: keep-alive
Content-Length: 35
Content-Type: application/json
Date: Wed, 09 Dec 2020 07:02:18 GMT

{
    "bird_class": "053.Western_Grebe"
}
```

# Cleanup

Destroy deployed resources on this project

```bash
$ cdk destroy "*"
```