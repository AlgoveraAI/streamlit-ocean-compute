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
from web3 import Web3
from ocean_lib.config import Config
from ocean_lib.ocean.ocean import Ocean
from ocean_lib.web3_internal.wallet import Wallet
from ocean_lib.web3_internal.constants import ZERO_ADDRESS
from ocean_lib.web3_internal.currency import pretty_ether_and_wei, to_wei


# Ocean Search
config = Config('./streamlit_ocean_compute/config.ini')
ocean = Ocean(config)
# st.write(f"Ocean network: {ocean.config.network_url}")

_ocean_data = components.declare_component("ocean_data", url="http://localhost:3003/")
def ocean_data(label, did="", key=None, user_address=None, dt_did=None, alg_did=None, message="Run Compute", color="#3388FF"):
    """
    Wallet Connect component.
    """
    return _ocean_data(label=label, did=did, default="", key=key, user_address=user_address, data_did=dt_did, algo_did=alg_did, message=message, color=color)


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
    ocean_compute_button = ocean_data(label="ocean_compute", key=algo_did, user_address=user_address, dt_did=data_did, alg_did=algo_did, message="Run Compute", color="#3388FF")
    if isinstance(ocean_compute_button, list):
        st.write(f"Compute started with job ID: {ocean_compute_button[0]}")
    ocean_compute_button2 = ocean_data(label="ocean_compute2", key="algo_did", user_address=user_address, dt_did=data_did, alg_did=algo_did, message="Check Status", color="#A44CD3")