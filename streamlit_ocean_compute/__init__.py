from ast import arg
import re
from unittest import result
import streamlit.components.v1 as components
import streamlit as st
import os

from PIL import Image

import matplotlib.pyplot as plt
import numpy as np

from wallet_connect import wallet_connect


_ocean_data = components.declare_component("ocean_compute", url="http://localhost:3003/")
# parent_dir = os.path.dirname(os.path.abspath(__file__))
# build_dir = os.path.join(parent_dir, "frontend/build")
# _ocean_data = components.declare_component("ocean_compute", path=build_dir)

def ocean_data(label, did="", key=None, user_address=None, dt_did=None, alg_did=None, message="Run Compute", color="#3388FF", job_id="None"):
    """
    Wallet Connect component.
    """
    return _ocean_data(label=label, did=did, default="", key=key, user_address=user_address, data_did=dt_did, algo_did=alg_did, message=message, color=color, job_id=job_id)


results = None
address = None
user_address = wallet_connect(label="connect_button")
if user_address[0] != "n":
    # address = Web3.toChecksumAddress(user_address[0])
    # st.write(address)
    st.write(user_address)


st.header("Run Compute to Data")
data_did = st.text_input("Data DID: ", "")
algo_did = st.text_input("Algorithm DID: ", "")

if data_did and algo_did:
    ocean_compute_button = ocean_data(label="ocean_compute", key="c2d", user_address=user_address, dt_did=data_did, alg_did=algo_did, message="Run Compute", color="#3388FF")
    if isinstance(ocean_compute_button, list):
        st.write(f"Compute started with job ID: {ocean_compute_button[0]}")
    job_id = st.text_input("Compute Job ID: ", "")
    ocean_compute_button2 = ocean_data(label="ocean_compute2", key="status", user_address=user_address, dt_did=data_did, alg_did=algo_did, message="Check Status", color="#A44CD3", job_id=job_id)
    st.write(f"Compute Status is: {ocean_compute_button2}")
    ocean_compute_button3 = ocean_data(label="ocean_compute3", key="results", user_address=user_address, dt_did=data_did, alg_did=algo_did, message="Get Results", color="#77C063",  job_id=job_id)
    st.write(f"Compute Results available here: {ocean_compute_button3}")

def sample_compute():
    st.header("Run Compute to Data")
    data_did = st.text_input("Data DID: ", "")
    algo_did = st.text_input("Algorithm DID: ", "")

    if data_did and algo_did:
        ocean_compute_button = ocean_data(label="ocean_compute", key="c2d", user_address=user_address, dt_did=data_did, alg_did=algo_did, message="Run Compute", color="#3388FF")
        if isinstance(ocean_compute_button, list):
            st.write(f"Compute started with job ID: {ocean_compute_button[0]}")
        job_id = st.text_input("Compute Job ID: ", "")
        ocean_compute_button2 = ocean_data(label="ocean_compute2", key="status", user_address=user_address, dt_did=data_did, alg_did=algo_did, message="Check Status", color="#A44CD3", job_id=job_id)
        st.write(f"Compute Status is: {ocean_compute_button2}")
        ocean_compute_button3 = ocean_data(label="ocean_compute3", key="results", user_address=user_address, dt_did=data_did, alg_did=algo_did, message="Get Results", color="#77C063",  job_id=job_id)
        st.write(f"Compute Results available here: {ocean_compute_button3}")