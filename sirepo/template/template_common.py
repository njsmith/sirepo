# -*- coding: utf-8 -*-
u"""SRW execution template.

:copyright: Copyright (c) 2015 RadiaSoft LLC.  All Rights Reserved.
:license: http://www.apache.org/licenses/LICENSE-2.0.html
"""
from __future__ import absolute_import, division, print_function
from pykern import pkcollections
from pykern import pkcompat
from pykern import pkio
from pykern import pkjinja
from pykern import pkresource
from pykern.pkdebug import pkdc, pkdlog, pkdp
import hashlib
import json
import numpy as np
import os.path
import py.path
import re
import sirepo.template

ANIMATION_ARGS_VERSION_RE = re.compile(r'v(\d+)$')

DEFAULT_INTENSITY_DISTANCE = 20

#: Input json file
INPUT_BASE_NAME = 'in'

LIB_FILE_PARAM_RE = re.compile(r'.*File$')

#: Output json file
OUTPUT_BASE_NAME = 'out'

#: Python file (not all simulations)
PARAMETERS_PYTHON_FILE = 'parameters.py'

#: stderr and stdout
RUN_LOG = 'run.log'

_HISTOGRAM_BINS_MAX = 500

_PLOT_LINE_COLOR = ['#1f77b4', '#ff7f0e', '#2ca02c']

_RESOURCE_DIR = py.path.local(pkresource.filename('template'))

_WATCHPOINT_REPORT_NAME = 'watchpointReport'


def compute_field_range(args, compute_range):
    """ Computes the fieldRange values for all parameters across all animation files.
    Caches the value on the animation input file. compute_range() is called to
    read the simulation specific datafiles and extract the ranges by field.
    """
    from sirepo import simulation_db
    run_dir = simulation_db.simulation_run_dir({
        'simulationType': args['simulationType'],
        'simulationId': args['simulationId'],
        'report': 'animation',
    })
    data = simulation_db.read_json(run_dir.join(INPUT_BASE_NAME))
    res = None
    model_name = args['modelName']
    if model_name in data.models:
        if 'fieldRange' in data.models[model_name]:
            res = data.models[model_name].fieldRange
        else:
            res = compute_range(run_dir, data)
            data.models[model_name].fieldRange = res
            simulation_db.write_json(run_dir.join(INPUT_BASE_NAME), data)
    return {
        'fieldRange': res,
    }


def compute_plot_color_and_range(plots):
    """ For parameter plots, assign each plot a color and compute the full y_range. """
    y_range = None
    for i in range(len(plots)):
        plot = plots[i]
        plot['color'] = _PLOT_LINE_COLOR[i]
        vmin = min(plot['points'])
        vmax = max(plot['points'])
        if y_range:
            if vmin < y_range[0]:
                y_range[0] = vmin
            if vmax > y_range[1]:
                y_range[1] = vmax
        else:
            y_range = [vmin, vmax]
    return y_range


def copy_lib_files(data, source, target):
    """Copy auxiliary files to target

    Args:
        data (dict): simulation db
        target (py.path): destination directory
    """
    for f in lib_files(data, source):
        path = target.join(f.basename)
        pkio.mkdir_parent_only(path)
        if not path.exists():
            if not f.exists():
                sim_resource = resource_dir(data.simulationType)
                r = sim_resource.join(f.basename)
                # the file doesn't exist in the simulation lib, check the resource lib
                if r.exists():
                    pkio.mkdir_parent_only(f)
                    r.copy(f)
                else:
                    pkdlog('No file in lib or resource: {}', f)
                    continue
            if source:
                # copy files from another session
                f.copy(path)
            else:
                # symlink into the run directory
                path.mksymlinkto(f, absolute=False)


def enum_text(schema, name, value):
    for e in schema['enum'][name]:
        if e[0] == value:
            return e[1]
    assert False, 'unknown {} enum value: {}'.format(name, value)


def flatten_data(d, res, prefix=''):
    """Takes a nested dictionary and converts it to a single level dictionary with flattened keys."""
    for k in d:
        v = d[k]
        if isinstance(v, dict):
            flatten_data(v, res, prefix + k + '_')
        elif isinstance(v, list):
            pass
        else:
            res[prefix + k] = v
    return res


def filename_to_path(files, source_lib):
    """Returns full, unique paths of simulation files

    Returns:
        list: py.path.local to files
    """
    res = []
    seen = set()
    for f in files:
        if f not in seen:
            seen.add(f)
            res.append(source_lib.join(f))
    return res


def heatmap(values, model, plot_fields=None):
    """Computes a report histogram (x_range, y_range, z_matrix) for a report model."""
    range = None
    if not np.any(values):
        values = [[], []]
    if 'plotRangeType' in model:
        if model['plotRangeType'] == 'fixed':
            range = [_plot_range(model, 'horizontal'), _plot_range(model, 'vertical')]
        elif model['plotRangeType'] == 'fit' and 'fieldRange' in model:
            range = [model.fieldRange[model['x']], model.fieldRange[model['y']]]
    hist, edges = np.histogramdd(values, histogram_bins(model['histogramBins']), range=range)
    res = {
        'x_range': [float(edges[0][0]), float(edges[0][-1]), len(hist)],
        'y_range': [float(edges[1][0]), float(edges[1][-1]), len(hist[0])],
        'z_matrix': hist.T.tolist(),
    }
    if plot_fields:
        res.update(plot_fields)
    return res


def histogram_bins(nbins):
    """Ensure the histogram count is in a valid range"""
    nbins = int(nbins)
    if nbins <= 0:
        nbins = 1
    elif nbins > _HISTOGRAM_BINS_MAX:
        nbins = _HISTOGRAM_BINS_MAX
    return nbins


def is_watchpoint(name):
    return _WATCHPOINT_REPORT_NAME in name


def lib_file_name(model_name, field, value):
    return '{}-{}.{}'.format(model_name, field, value)


def lib_files(data, source_lib=None):
    """Return list of files used by the simulation

    Args:
        data (dict): sim db

    Returns:
        list: py.path.local to files
    """
    from sirepo import simulation_db
    sim_type = data.simulationType
    return sirepo.template.import_module(data).lib_files(
        data,
        source_lib or simulation_db.simulation_lib_dir(sim_type),
    )


def model_defaults(name, schema):
    """Returns a set of default model values from the schema."""
    res = pkcollections.Dict()
    for f in schema['model'][name]:
        field_info = schema['model'][name][f]
        if len(field_info) >= 3 and field_info[2] is not None:
            res[f] = field_info[2]
    return res


def parameter_plot(x, plots, model, plot_fields=None):
    res = {
        'x_points': x,
        'x_range': [min(x), max(x)],
        'plots': plots,
        'y_range': compute_plot_color_and_range(plots),
    }
    if 'plotRangeType' in model:
        if model.plotRangeType == 'fixed':
            res['x_range'] = _plot_range(model, 'horizontal')
            res['y_range'] = _plot_range(model, 'vertical')
        elif model.plotRangeType == 'fit':
            res['x_range'] = model.fieldRange[model.x]
            for i in range(len(plots)):
                r = model.fieldRange[plots[i]['field']]
                if r[0] < res['y_range'][0]:
                    res['y_range'][0] = r[0]
                if r[1] > res['y_range'][1]:
                    res['y_range'][1] = r[1]
    if plot_fields:
        res.update(plot_fields)
    return res


def parse_animation_args(data, key_map):
    """Parse animation args according to key_map

    Args:
        data (dict): contains animationArgs
        key_map (dict): version to keys mapping, default is ''
    Returns:
        Dict: mapped animationArgs with version
    """
    a = data['animationArgs'].split('_')
    m = ANIMATION_ARGS_VERSION_RE.search(a[0])
    if m:
        a.pop(0)
        v = int(m.group(1))
    else:
        v = 1
    try:
        keys = key_map[v]
    except KeyError:
        keys = key_map['']
    res = pkcollections.Dict(zip(keys, a))
    res.version = v
    return res


def parse_enums(enum_schema):
    """Returns a list of enum values, keyed by enum name."""
    res = {}
    for k in enum_schema:
        res[k] = {}
        for v in enum_schema[k]:
            res[k][v[0]] = True
    return res


def render_jinja(sim_type, v, name=PARAMETERS_PYTHON_FILE):
    """Render the values into a jinja template.

    Args:
        sim_type (str): application name
        v: flattened model data
    Returns:
        str: source text
    """
    b = resource_dir(sim_type).join(name)
    return pkjinja.render_file(b + '.jinja', v)


def report_parameters_hash(data):
    """Compute a hash of the parameters for his report.

    Only needs to be unique relative to the report, not globally unique
    so MD5 is adequate. Long and cryptographic hashes make the
    cache checks slower.

    Args:
        data (dict): report and related models
    Returns:
        str: url safe encoded hash
    """
    if not 'reportParametersHash' in data:
        models = sirepo.template.import_module(data).models_related_to_report(data)
        res = hashlib.md5()
        dm = data['models']
        for m in models:
            if pkcompat.isinstance_str(m):
                name, field = m.split('.') if '.' in m else (m, None)
                value = dm[name][field] if field else dm[name]
            else:
                value = m
            res.update(json.dumps(value, sort_keys=True, allow_nan=False).encode())
        data['reportParametersHash'] = res.hexdigest()
    return data['reportParametersHash']

def report_fields(data, report_name, style_fields):
    # if the model has "style" fields, then return the full list of non-style fields
    # otherwise returns the report name (which implies all model fields)
    m = data.models[report_name]
    for style_field in style_fields:
        if style_field not in m:
            continue
        res = []
        for f in m:
            if f in style_fields:
                continue
            res.append('{}.{}'.format(report_name, f))
        return res
    return [report_name]


def resource_dir(sim_type):
    """Where to get library files from

    Args:
        sim_type (str): application name
    Returns:
        py.path.Local: absolute path to folder
    """
    return _RESOURCE_DIR.join(sim_type)


def update_model_defaults(model, name, schema):
    defaults = model_defaults(name, schema)
    for f in defaults:
        if f not in model:
            model[f] = defaults[f]


def validate_model(model_data, model_schema, enum_info):

    """Ensure the value is valid for the field type. Scales values as needed."""
    for k in model_schema:
        label = model_schema[k][0]
        field_type = model_schema[k][1]
        if k in model_data:
            value = model_data[k]
        elif len(model_schema[k]) > 2:
            value = model_schema[k][2]
        else:
            raise Exception('no value for field "{}" and no default value in schema'.format(k))
        if field_type in enum_info:
            if str(value) not in enum_info[field_type]:
                # Check a comma-delimited string against the enumeration
                for item in re.split(r'\s*,\s*', str(value)):
                    if item not in enum_info[field_type]:
                        assert item in enum_info[field_type], \
                            '{}: invalid enum "{}" value for field "{}"'.format(item, field_type, k)
        elif field_type == 'Float':
            if not value:
                value = 0
            v = float(value)
            if re.search('\[m(m|rad)\]', label) or re.search('\[Lines/mm', label):
                v /= 1000
            elif re.search('\[n(m|rad)\]', label) or re.search('\[nm/pixel\]', label):
                v /= 1e09
            elif re.search('\[ps]', label):
                v /= 1e12
            #TODO(pjm): need to handle unicode in label better (mu)
            elif re.search('\[\xb5(m|rad)\]', label) or re.search('\[mm-mrad\]', label):
                v /= 1e6
            model_data[k] = float(v)
        elif field_type == 'Integer':
            if not value:
                value = 0
            model_data[k] = int(value)
        else:
            model_data[k] = _escape(value)


def validate_models(model_data, model_schema):
    """Validate top-level models in the schema. Returns enum_info."""
    enum_info = parse_enums(model_schema['enum'])
    for k in model_data['models']:
        if k in model_schema['model']:
            validate_model(model_data['models'][k], model_schema['model'][k], enum_info)
    if 'beamline' in model_data['models']:
        for m in model_data['models']['beamline']:
            validate_model(m, model_schema['model'][m['type']], enum_info)
    return enum_info


def file_extension_ok(file_path, white_list=[], black_list=['py', 'pyc']):
    """Determine whether a file has an acceptable extension

    Args:
        file_path (str): name of the file to examine
        white_list ([str]): list of file types allowed (defaults to empty list)
        black_list ([str]): list of file types rejected (defaults to ['py', 'pyc']). Ignored if white_list is not empty
    Returns:
        If file is a directory: True
        If white_list non-empty: True if the file's extension matches any in the list, otherwise False
        If white_list is empty: False if the file's extension matches any in black_list, otherwise True
    """
    import os

    if os.path.isdir(file_path):
        return True
    if len(white_list) > 0:
        in_list = False
        for ext in white_list:
            in_list = in_list or pkio.has_file_extension(file_path, ext)
        if not in_list:
            return False
        return True
    for ext in black_list:
        if pkio.has_file_extension(file_path, ext):
            return False
    return  True


def watchpoint_id(report):
    m = re.search(_WATCHPOINT_REPORT_NAME + '(\d+)', report)
    if not m:
        raise RuntimeError('invalid watchpoint report name: ', report)
    return int(m.group(1))


def _escape(v):
    return re.sub("[\"'()]", '', str(v))


def _plot_range(report, axis):
    half_size = float(report['{}Size'.format(axis)]) / 2.0
    midpoint = float(report['{}Offset'.format(axis)])
    return [midpoint - half_size, midpoint + half_size]
