# -*- coding: utf-8 -*-
u"""sirepo package

:copyright: Copyright (c) 2018 RadiaSoft LLC.  All Rights Reserved.
:license: http://www.apache.org/licenses/LICENSE-2.0.html
"""
from __future__ import absolute_import, division, print_function

from pykern import pkcollections
from pykern.pkdebug import pkdp, pkdc, pkdlog, pkdexc
from sirepo.template import template_common
import contextlib
import docker
import functools
import re
import requests
import shlex
import trio

# How often threaded blocking operations should wake up and check for Trio
# cancellation
_CANCEL_POLL_INTERVAL = 1

# Global connection pools (don't worry, it won't actually make any connections
# until we start using it)
_DOCKER = docker.from_env()

def _container_name(run_dir, job_type):
    # Docker container names have to start with [a-zA-Z0-9], and after that
    # can also contain [_.-].
    return 'sirepo-{}-{}'.format(job_type, str(run_dir).replace('/', '-'))


# Helper to call container.wait in a async/cancellation-friendly way
async def _container_wait(container):
    while True:
        try:
            return await trio.run_sync_in_worker_thread(
                functools.partial(container.wait, timeout=_CANCEL_POLL_INTERVAL),
            )
        # ReadTimeout is what the documentation says this raises.
        # ConnectionError is what it actually raises.
        # We'll catch both just to be safe.
        except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError):
            pass


async def _clear_container(name):
    try:
        old_container = await trio.run_sync_in_worker_thread(
            _DOCKER.containers.get, name,
        )
    except docker.errors.NotFound:
        pass
    else:
        pkdlog('found stale container {}; removing', name)
        await trio.run_sync_in_worker_thread(old_container.remove)


# Helper w/ shared logic for start_report_job and run_extract_job
async def _make_container(run_dir, quoted_bash_cmd, job_type):
    # We can't just pass the cmd directly to docker because we have to detour
    # through bash to set up our environment. But we do assume that it's
    # sufficiently well-behaved that shlex.quote will work.
    docker_cmd = [
        '/bin/bash',
        '-c',
        '. ~/.bashrc && ' + quoted_bash_cmd,
    ]

    name = _container_name(run_dir, job_type)

    await _clear_container(name)

    return await trio.run_sync_in_worker_thread(
        functools.partial(
            _DOCKER.containers.run,
            'radiasoft/sirepo',
            docker_cmd,
            working_dir=str(run_dir),
            # {host path: {'bind': container path, 'mode': 'rw'}}
            volumes={str(run_dir): {'bind': str(run_dir), 'mode': 'rw'}},
            name=name,
            detach=True,
            init=True,
        )
    )


async def start_report_job(run_dir, cmd):
    run_log_path = run_dir.join(template_common.RUN_LOG)
    quoted_cmd = ' '.join(shlex.quote(c) for c in cmd)
    quoted_outpath = shlex.quote(str(run_log_path))
    quoted_bash_cmd = f'{quoted_cmd} >{quoted_outpath} 2>&1'

    container = await _make_container(run_dir, quoted_bash_cmd, 'report')

    return _DockerReportJob(container)


class _DockerReportJob:
    # no backend-specific per-process info.... yet
    # later will have output dir, host, or whatever we need
    backend_info = {}

    def __init__(self, container):
        self._container = container

    async def kill(self, grace_period):
        with contextlib.suppress(docker.errors.NotFound):
            await trio.run_sync_in_worker_thread(
                functools.partial(self._container.stop, timeout=grace_period)
            )

    async def wait(self):
        result = await _container_wait(self._container)
        await trio.run_sync_in_worker_thread(self._container.remove)
        return result['StatusCode']


async def run_extract_job(run_dir, cmd, backend_info):
    # no output redirection here - we want to let the docker daemon collect it
    quoted_bash_cmd = ' '.join(shlex.quote(c) for c in cmd)
    # We never run more than one extract job at a time in a given run_dir, so
    # no need to give them unique names.
    container = await _make_container(run_dir, quoted_bash_cmd, 'extract')
    try:
        result = await _container_wait(container)
        stdout = await trio.run_sync_in_worker_thread(
            functools.partial(
                container.logs,
                stdout=True,
                stderr=False,
            )
        )
        stderr = await trio.run_sync_in_worker_thread(
            functools.partial(
                container.logs,
                stdout=False,
                stderr=True,
            )
        )
        return pkcollections.Dict(
            returncode=result['StatusCode'],
            stdout=stdout,
            stderr=stderr,
        )
    finally:
        await trio.run_sync_in_worker_thread(container.remove)
