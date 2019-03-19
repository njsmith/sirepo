# -*- coding: utf-8 -*-
u"""Operations run inside the report directory to extract data.

:copyright: Copyright (c) 2019 RadiaSoft LLC.  All Rights Reserved.
:license: http://www.apache.org/licenses/LICENSE-2.0.html
"""

from pykern import pkio
from pykern import pkjson
from sirepo import simulation_db
import functools
import sirepo
import sys


# These commands take json-encoded arguments, and then print their result as
# json to stdout.
def _extract_cmd(fn):
    @functools.wraps(fn)
    def wrapper(*args):
        result = fn(*[pkjson.load_any(arg) for arg in args])
        encoded = pkjson.dump_pretty(result)
        sys.stdout.write(encoded)
    return wrapper


# These commands are always run with cwd set to the appropriate run_dir
def _run_dir():
    return pkio.py_path('.')


def _params():
    return pkjson.load_any(_run_dir().join('in.json'))


@_extract_cmd
def remove_last_frame():
    template = sirepo.template.import_module(_params())
    if hasattr(template, 'remove_last_frame'):
        template.remove_last_frame(_run_dir())


@_extract_cmd
def background_percent_complete(is_running):
    params = _params()
    template = sirepo.template.import_module(params)
    return template.background_percent_complete(
        params.report, _run_dir(), is_running,
    )


# XX FIXME: can we avoid passing the whole data dict through here?
@_extract_cmd
def result(data):
    rep = simulation_db.report_info(data)
    template = sirepo.template.import_module(data)

    if hasattr(template, 'prepare_output_file') and 'models' in data:
        template.prepare_output_file(rep, data)
    # Basically this returns (state dict, None), or else (None, stderr string)
    res, err = simulation_db.read_result(_run_dir())
    if err and hasattr(template, 'parse_error_log'):
        parsed_res = template.parse_error_log(_run_dir())
        if parsed_res:
            return (parsed_res, None)
    return res, err


@_extract_cmd
def get_simulation_frame(frame_data):
    params = _params()
    template = sirepo.template.import_module(params)
    return template.get_simulation_frame(_run_dir(), frame_data, params)
