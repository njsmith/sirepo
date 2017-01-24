# -*- coding: utf-8 -*-
u"""?

:copyright: Copyright (c) 2017 RadiaSoft LLC.  All Rights Reserved.
:license: http://www.apache.org/licenses/LICENSE-2.0.html
"""
from __future__ import absolute_import, division, print_function
import pytest
pytest.importorskip('srwl_bl')

def test_processed_image():
    from pykern.pkdebug import pkdp
    from pykern.pkunit import pkeq, pkfail
    from pykern import pkunit
    from sirepo import sr_unit

    fc = sr_unit.flask_client()
    sim_type = 'srw'
    sim_id = fc.sr_sim_data(sim_type, 'Sample from Image')
    resp = fc.sr_post(
        'getApplicationData',
        {
            'simulationId': sim_id,
            'simulationType': sim_type,
            'method': 'processedImage',
            'baseImage': 'sample.tif',
        },
        {
            'filename': 'foo.tif',
        },
        raw_response=True,
    )
    with open(str(pkunit.work_dir().join('x.tif')), 'wb') as f:
        f.write(resp.data)