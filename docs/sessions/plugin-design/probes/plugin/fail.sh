#!/usr/bin/env bash
echo "fail-now stdout: this should appear in plugin logs" 
echo "fail-now stderr: boom" >&2
exit 7
